<?php

namespace App\Http\Controllers;

use App\Jobs\ParseOrganizationReviewsJob;
use App\Models\Organization;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class OrganizationController extends Controller
{
    /**
     * Получить сохранённую организацию.
     */
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

    /**
     * Сохранить URL организации и запустить парсинг.
     */
    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'yandex_url' => [
                'required',
                'url',
            ],
        ]);

        $organization = Organization::first();

        if (!$organization) {
            $organization = Organization::create([
                'yandex_url' => $validated['yandex_url'],
            ]);
        } else {
            $organization->update([
                'yandex_url' => $validated['yandex_url'],
            ]);
        }

        ParseOrganizationReviewsJob::dispatch($organization);

        return response()->json([
            'message' => 'Organization saved. Parsing started.',
            'organization' => $organization->fresh(),
        ], 202);
    }

    /**
     * Получить отзывы с пагинацией.
     */
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

    /**
     * Повторно запустить парсинг отзывов.
     */
    public function refresh(): JsonResponse
    {
        $organization = Organization::first();

        if (!$organization) {
            return response()->json([
                'message' => 'Organization not found.',
            ], 404);
        }

        ParseOrganizationReviewsJob::dispatch($organization);

        return response()->json([
            'message' => 'Parsing started.',
        ], 202);
    }
}