<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Organization extends Model
{
    protected $fillable = ['yandex_url', 'yandex_id', 'name', 'rating', 'ratings_count', 'reviews_count', 'last_parsed_at',];

    protected $casts = [
        'rating' => 'decimal:2',
        'last_parsed_at' => 'datetime',
    ];

    public function reviews(): HasMany
    {
        return $this->hasMany(Review::class);
    }
}
