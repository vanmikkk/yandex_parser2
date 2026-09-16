<?php

namespace App\Jobs;

use App\Models\Organization;
use App\Services\YandexParserService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Throwable;

class ParseOrganizationReviewsJob implements ShouldQueue
{
    use InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;

    public int $timeout = 900;

    public function __construct(
        public Organization $organization
    ) {
    }

    public function handle(YandexParserService $parser): void
    {
        $this->organization->update([
            'parse_status' => 'running',
            'parse_progress' => 0,
            'parse_error' => null,
        ]);

        try {
            $data = $parser->parseReviews(
                $this->organization->yandex_url,
                $this->organization
            );

            if (!($data['collectionComplete'] ?? false)) {
                throw new \RuntimeException(
                    sprintf(
                        'Не удалось собрать все доступные отзывы: собрано %d из %d.',
                        $data['collectedReviews'] ?? count($data['reviews'] ?? []),
                        $data['availableReviews'] ?? ($data['totalReviews'] ?? 0)
                    )
                );
            }

            $parser->saveReviews(
                $this->organization,
                $data['reviews'],
                [
                    'name' => $data['name'] ?? null,
                    'rating' => $data['rating'] ?? null,
                    'ratingsCount' => $data['ratingsCount'] ?? 0,
                    'totalReviews' => $data['totalReviews'] ?? null,
                ]
            );

            $this->organization->update([
                'parse_status' => 'completed',
                'parse_progress' => 100,
                'parse_error' => null,
                'last_parsed_at' => now(),
            ]);
        } catch (Throwable $e) {
            $this->organization->update([
                'parse_status' => 'failed',
                'parse_error' => $e->getMessage(),
            ]);

            throw $e;
        }
    }

    public function failed(Throwable $exception): void
    {
        $this->organization->update([
            'parse_status' => 'failed',
            'parse_error' => $exception->getMessage(),
        ]);
    }
}