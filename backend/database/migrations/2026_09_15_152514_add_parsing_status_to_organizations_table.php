<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('organizations', function (Blueprint $table) {
            $table->string('parse_status')->default('idle')->after('last_parsed_at');
            $table->unsignedInteger('parse_progress')->default(0)->after('parse_status');
            $table->text('parse_error')->nullable()->after('parse_progress');
        });
    }

    public function down(): void
    {
        Schema::table('organizations', function (Blueprint $table) {
            $table->dropColumn([
                'parse_status',
                'parse_progress',
                'parse_error',
            ]);
        });
    }
};