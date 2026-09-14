<?php

use App\Http\Controllers\AuthController;
use App\Http\Controllers\OrganizationController;
use Illuminate\Support\Facades\Route;
use Illuminate\Http\Request;

Route::post('/login', [AuthController::class, 'login']);
Route::post('/logout', [AuthController::class, 'logout'])
    ->middleware('auth:sanctum');

Route::get('/me', [AuthController::class, 'me'])
    ->middleware('auth:sanctum');

Route::middleware('auth:sanctum')->group(function () {
    Route::get('/organization', [OrganizationController::class, 'show']);
    Route::post('/organization', [OrganizationController::class, 'store']);

    Route::get('/organization/reviews', [OrganizationController::class, 'reviews']);
    Route::post('/organization/refresh', [OrganizationController::class, 'refresh']);
});


Route::get('/debug-auth', function (Request $request) {
    return response()->json([
        'auth_check' => auth()->check(),
        'user' => $request->user(),
        'session_id' => $request->session()->getId(),
        'session_data' => $request->session()->all(),
    ]);
})->middleware('auth:sanctum');