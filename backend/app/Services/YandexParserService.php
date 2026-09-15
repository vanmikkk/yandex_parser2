<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use GuzzleHttp\Cookie\CookieJar;
use Symfony\Component\Process\Process;
use App\Models\Organization;
use App\Models\Review;
use Carbon\Carbon;
use RuntimeException;

class YandexParserService
{
    public function fetchOrganizationPage(string $url): array
    {
        $cookieJar = new CookieJar();

        $client = Http::withoutVerifying()
            ->timeout(20)
            ->withOptions([
                'cookies' => $cookieJar,
            ])
            ->withHeaders([
                'User-Agent' => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36',
                'Accept-Language' => 'ru-RU,ru;q=0.9,en;q=0.8',
            ]);

        $response = $client->get($url);

        if ($response->failed()) {
            throw new RuntimeException(
                'Yandex Maps returned HTTP ' . $response->status()
            );
        }

        $html = $response->body();

        $csrfToken = $this->extractCsrfToken($html);

        if (!$csrfToken) {
            throw new RuntimeException('csrfToken не найден в HTML страницы.');
        }

        $businessId = $this->extractBusinessIdFromUrl($url);

        if (!$businessId) {
            throw new RuntimeException('businessId не найден в URL организации.');
        }

        return [
            'businessId' => $businessId,
            'csrfToken' => $csrfToken,
            'cookies' => $cookieJar->toArray(),
        ];
    }

    private function extractCsrfToken(string $html): ?string
    {
        if (preg_match('/"csrfToken"\s*:\s*"([^"]+)"/', $html, $matches)) {
            return $matches[1];
        }

        return null;
    }

    private function extractBusinessIdFromUrl(string $url): ?string
    {
        if (preg_match('/oid[=%3F]*%3D?(\d+)/i', $url, $matches)) {
            return $matches[1];
        }

        if (preg_match('~/org/[^/]+/(\d+)~', $url, $matches)) {
            return $matches[1];
        }

        return null;
    }

    public function fetchReviews(
        string $businessId,
        string $csrfToken,
        array $cookies,
        int $page = 1,
        ?string $s = null,
        ?string $reqId = null,
        ?string $sessionId = null
    ): array {
        $cookieJar = new \GuzzleHttp\Cookie\CookieJar();

        foreach ($cookies as $cookie) {
            $cookieJar->setCookie(
                new \GuzzleHttp\Cookie\SetCookie([
                    'Name'   => $cookie['Name'],
                    'Value'  => $cookie['Value'],
                    'Domain' => $cookie['Domain'] ?? 'yandex.ru',
                    'Path'   => $cookie['Path'] ?? '/',
                ])
            );
        }

        // $sessionId = null;

        // foreach ($cookies as $cookie) {
        //     if (($cookie['Name'] ?? null) === 'maps_session_id') {
        //         $sessionId = $cookie['Value'] ?? null;
        //         break;
        //     }
        // }

        $query = [
            'ajax'       => 1,
            'businessId' => $businessId,
            'csrfToken'  => $csrfToken,
            'locale'     => 'ru_RU',
            'page'       => $page,
            'pageSize'   => 50,
            'ranking'    => 'by_relevance_org',
            'reqId'      => $reqId,
            's'          => $s,
            'sessionId'  => $sessionId,
        ];

        if ($sessionId) {
            $query['sessionId'] = $sessionId;
        }

        if ($s !== null) {
            $query['s'] = $s;
        }

        $response = Http::withoutVerifying()
            ->timeout(30)
            ->withOptions([
                'cookies' => $cookieJar,
            ])
            ->withHeaders([
                'Accept' => '*/*',
                'Accept-Language' => 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
                'Cache-Control' => 'no-cache',
                'Pragma' => 'no-cache',
                'Referer' => 'https://yandex.ru/maps/',
                'User-Agent' => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153.0.0.0 Safari/537.36',
                'X-Ya-Maps-Prestable' => '1',
            ])
            ->get('https://yandex.ru/maps/api/business/fetchReviews', $query);

        if (!$response->successful()) {
            throw new \RuntimeException(
                'Yandex fetchReviews failed: HTTP ' .
                $response->status() .
                ' body: ' .
                mb_substr($response->body(), 0, 2000)
            );
        }

        return $response->json();
    }

    public function parseReviews(string $url): array
    {
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

        $process->run();

        if (!$process->isSuccessful()) {
            throw new \RuntimeException(
                'Yandex parser failed: ' .
                trim($process->getErrorOutput())
            );
        }

        if (!file_exists($outputFile)) {
            throw new \RuntimeException(
                'Yandex parser did not create output file.'
            );
        }

        $contents = file_get_contents($outputFile);

        $data = json_decode($contents, true);

        // Удаляем временный файл после чтения.
        @unlink($outputFile);

        if (!is_array($data)) {
            throw new \RuntimeException(
                'Yandex parser returned invalid JSON.'
            );
        }

        if (!isset($data['reviews']) || !is_array($data['reviews'])) {
            throw new \RuntimeException(
                'Yandex parser response does not contain reviews.'
            );
        }

        return $data;
    }

    public function saveReviews($organization, array $reviews): int
    {
        $rows = [];

        foreach ($reviews as $review) {
            if (empty($review['reviewId'])) {
                continue;
            }

            $rows[] = [
                'organization_id' => $organization->id,
                'external_id' => $review['reviewId'],
                'author' => $review['author']['name'] ?? 'Unknown',
                'rating' => (int) ($review['rating'] ?? 0),
                'text' => $review['text'] ?? null,
                'published_at' => !empty($review['updatedTime'])
                    ? Carbon::parse($review['updatedTime'])->format('Y-m-d H:i:s')
                    : null,
                'created_at' => now(),
                'updated_at' => now(),
            ];
        }

        if (empty($rows)) {
            return 0;
        }

        Review::upsert(
            $rows,
            ['organization_id', 'external_id'],
            [
                'author',
                'rating',
                'text',
                'published_at',
                'updated_at',
            ]
        );

        $organization->update([
            'reviews_count' => Review::where(
                'organization_id',
                $organization->id
            )->count(),

            'last_parsed_at' => now(),
        ]);

        return count($rows);
    }
}