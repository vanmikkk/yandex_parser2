<?php

namespace App\Jobs;

use App\Models\Organization;
use App\Services\YandexParserService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;

class ParseOrganizationReviewsJob implements ShouldQueue
{
    use InteractsWithQueue;
    use Queueable;
    use SerializesModels;

    public int $tries = 3;

    public int $timeout = 900;

    public function __construct(
        public Organization $organization
    ) {
    }

    public function handle(YandexParserService $parser): void
    {
        $data = $parser->parseReviews(
            $this->organization->yandex_url
        );

        $parser->saveReviews(
            $this->organization,
            $data['reviews']
        );
    }
}