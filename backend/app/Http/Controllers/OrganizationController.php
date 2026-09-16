<?php

namespace App\Http\Controllers;

use App\Jobs\ParseOrganizationReviewsJob;
use App\Models\Organization;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class OrganizationController extends Controller
{
    public function show(): JsonResponse
    {
        $organization = Organization::first();

        if (!$organization) {
            return response()->json([
                'message' => 'Organization not found.',
            ], 404);
        }

        return response()->json([
            'organization' => $organization,
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'yandex_url' => [
            'required',
            'url',
            function (string $attribute, mixed $value, \Closure $fail) {
                $host = strtolower(
                    (string) parse_url($value, PHP_URL_HOST)
                );

                $path = (string) parse_url(
                    $value,
                    PHP_URL_PATH
                );

                $query = (string) parse_url(
                    $value,
                    PHP_URL_QUERY
                );

                $allowedHosts = [
                    'yandex.ru',
                    'www.yandex.ru',
                    'yandex.com',
                    'www.yandex.com',
                ];

                if (!in_array($host, $allowedHosts, true)) {
                    $fail(
                        'Ссылка должна вести на Яндекс Карты.'
                    );

                    return;
                }

                if (!str_starts_with($path, '/maps')) {
                    $fail(
                        'Ссылка должна вести на Яндекс Карты.'
                    );

                    return;
                }

                parse_str($query, $queryParams);

                $hasReviewsTab =
                    ($queryParams['tab'] ?? null) === 'reviews';

                $hasReviewsPath =
                    (bool) preg_match(
                        '#/reviews(?:/|$)#',
                        $path
                    );

                if (!$hasReviewsTab && !$hasReviewsPath) {
                    $fail(
                        'Ссылка должна вести на раздел «Отзывы» в Яндекс Картах.'
                    );
                }
            },
        ],
        ]);

        $organization = Organization::first();

        if ($organization?->parse_status === 'running') {
            return response()->json([
                'message' => 'Parsing is already running.',
                'organization' => $organization,
            ], 409);
        }

       if (!$organization) {
            $organization = Organization::create([
                'yandex_url' => $validated['yandex_url'],
                'parse_status' => 'running',
                'parse_progress' => 0,
                'parse_error' => null,
            ]);
        } else {
            $urlChanged = $organization->yandex_url !== $validated['yandex_url'];

            if ($urlChanged) {
                $organization->reviews()->delete();
            }

            $organization->update([
                'yandex_url' => $validated['yandex_url'],
                'parse_status' => 'running',
                'parse_progress' => 0,
                'parse_error' => null,
            ]);
        }

        ParseOrganizationReviewsJob::dispatch(
            $organization->fresh()
        );

        return response()->json([
            'message' => 'Organization saved. Parsing started.',
            'organization' => $organization->fresh(),
        ], 202);
    }

    public function reviews(Request $request): JsonResponse
    {
        $organization = Organization::first();

        if (!$organization) {
            return response()->json([
                'message' => 'Organization not found.',
            ], 404);
        }

        $reviews = $organization
            ->reviews()
            ->orderByDesc('published_at')
            ->paginate(50);

        return response()->json($reviews);
    }

    public function refresh(): JsonResponse
    {
        $organization = Organization::first();

        if (!$organization) {
            return response()->json([
                'message' => 'Organization not found.',
            ], 404);
        }

        if ($organization->parse_status === 'running') {
            return response()->json([
                'message' => 'Parsing is already running.',
                'organization' => $organization,
            ], 409);
        }

        $organization->update([
            'parse_status' => 'running',
            'parse_progress' => 0,
            'parse_error' => null,
        ]);

        ParseOrganizationReviewsJob::dispatch(
            $organization->fresh()
        );

        return response()->json([
            'message' => 'Parsing started.',
            'organization' => $organization->fresh(),
        ], 202);
    }
}