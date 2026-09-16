<?php

namespace App\Services;

use Illuminate\Support\Facades\Log;
use Symfony\Component\Process\Process;
use App\Models\Organization;
use App\Models\Review;
use Carbon\Carbon;
use RuntimeException;

class YandexParserService
{
    public function parseReviews(
        string $url,
        ?Organization $organization = null
    ): array {
        $directory = storage_path('app/yandex');

        if (!is_dir($directory)) {
            mkdir($directory, 0777, true);
        }

        $outputFile = $directory . DIRECTORY_SEPARATOR
            . 'reviews_' . uniqid() . '.json';

        $process = new Process([
            'node',
            base_path('scripts/yandex-reviews.cjs'),
            $url,
            $outputFile,
        ]);

        $process->setTimeout(600);

        $stderrBuffer = '';

        $process->run(function (
            string $type,
            string $buffer
        ) use (
            $organization,
            &$stderrBuffer
        ): void {
            if ($type !== Process::ERR) {
                if (trim($buffer) !== '') {
                    Log::debug('Yandex parser stdout', [
                        'output' => trim($buffer),
                    ]);
                }

                return;
            }

            // Node writes parser diagnostics and PROGRESS to stderr.
            Log::debug('Yandex parser stderr', [
                'output' => trim($buffer),
            ]);

            // Process output can arrive in chunks, so keep an incomplete
            // last line for the next callback invocation.
            $stderrBuffer .= $buffer;

            $lines = preg_split(
                '/\r\n|\r|\n/',
                $stderrBuffer
            );

            $stderrBuffer = array_pop($lines) ?? '';

            foreach ($lines as $line) {
                $line = trim($line);

                if ($line === '') {
                    continue;
                }

                if (preg_match(
                    '/PROGRESS:\s*(\d+)\s*\/\s*(\d+)/',
                    $line,
                    $matches
                )) {
                    $collected = (int) $matches[1];
                    $target = (int) $matches[2];

                    if ($organization && $target > 0) {
                        $progress = min(
                            100,
                            (int) round(
                                ($collected / $target) * 100
                            )
                        );

                        $organization->update([
                            'parse_status' => 'running',
                            'parse_progress' => $progress,
                            'parse_error' => null,
                        ]);
                    }
                }
            }
        });

        // Process the final partial stderr line, if there is one.
        $stderrBuffer = trim($stderrBuffer);

        if ($stderrBuffer !== '') {
            Log::debug('Yandex parser stderr (final)', [
                'output' => $stderrBuffer,
            ]);

            if (preg_match(
                '/PROGRESS:\s*(\d+)\s*\/\s*(\d+)/',
                $stderrBuffer,
                $matches
            )) {
                $collected = (int) $matches[1];
                $target = (int) $matches[2];

                if ($organization && $target > 0) {
                    $progress = min(
                        100,
                        (int) round(
                            ($collected / $target) * 100
                        )
                    );

                    $organization->update([
                        'parse_status' => 'running',
                        'parse_progress' => $progress,
                        'parse_error' => null,
                    ]);
                }
            }
        }

        $errorOutput = trim(
            $process->getErrorOutput()
        );

        Log::info('Yandex parser finished', [
            'successful' => $process->isSuccessful(),
            'exit_code' => $process->getExitCode(),
            'stderr' => $errorOutput,
        ]);

        if (!$process->isSuccessful()) {
            throw new RuntimeException(
                'Yandex parser failed: ' .
                $errorOutput
            );
        }

        if (!file_exists($outputFile)) {
            throw new RuntimeException(
                'Yandex parser did not create output file.'
            );
        }

        $contents = file_get_contents($outputFile);

        $data = json_decode(
            $contents,
            true
        );

        @unlink($outputFile);

        if (!is_array($data)) {
            throw new RuntimeException(
                'Yandex parser returned invalid JSON.'
            );
        }

        if (
            !isset($data['reviews']) ||
            !is_array($data['reviews'])
        ) {
            throw new RuntimeException(
                'Yandex parser response does not contain reviews.'
            );
        }

        Log::info('Yandex parser result', [
            'totalReviews' =>
                $data['totalReviews'] ?? null,

            'availableReviews' =>
                $data['availableReviews'] ?? null,

            'collectedReviews' =>
                $data['collectedReviews']
                ?? count($data['reviews']),

            'collectionComplete' =>
                $data['collectionComplete'] ?? null,

            'lastPage' =>
                $data['lastPage'] ?? null,
        ]);

        if (
            array_key_exists(
                'collectionComplete',
                $data
            )
            && $data['collectionComplete'] !== true
        ) {
            throw new RuntimeException(
                sprintf(
                    'Yandex parser collected an incomplete set of reviews: %d of %d.',
                    (int) (
                        $data['collectedReviews']
                        ?? count($data['reviews'])
                    ),
                    (int) (
                        $data['availableReviews']
                        ?? (
                            $data['totalReviews']
                            ?? count($data['reviews'])
                        )
                    )
                )
            );
        }

        return $data;
    }

    public function saveReviews(
        Organization $organization,
        array $reviews,
        array $organizationData = []
    ): int {
        $rows = [];

        $reviews = array_slice(
            $reviews,
            0,
            600
        );

        foreach ($reviews as $review) {
            if (empty($review['reviewId'])) {
                continue;
            }

            $rows[] = [
                'organization_id' => $organization->id,

                'external_id' =>
                    $review['reviewId'],

                'author' =>
                    $review['author']['name']
                    ?? 'Unknown',

                'rating' =>
                    (int) (
                        $review['rating']
                        ?? 0
                    ),

                'text' =>
                    $review['text']
                    ?? null,

                'published_at' =>
                    !empty($review['updatedTime'])
                        ? Carbon::parse(
                            $review['updatedTime']
                        )->format(
                            'Y-m-d H:i:s'
                        )
                        : null,

                'created_at' => now(),
                'updated_at' => now(),
            ];
        }

        if (empty($rows)) {
            return 0;
        }

        $organization->reviews()->delete();

        if (!empty($rows)) {
            Review::insert($rows);
        }

        $organization->update([
            'name' =>
                $organizationData['name']
                ?? $organization->name,

            'rating' =>
                $organizationData['rating']
                ?? $organization->rating,

            'ratings_count' =>
                $organizationData['ratingsCount']
                ?? $organization->ratings_count,

            'reviews_count' =>
                $organizationData['totalReviews']
                ?? $organization->reviews()->count(),

            'last_parsed_at' => now(),
        ]);

        return count($rows);
    }
}