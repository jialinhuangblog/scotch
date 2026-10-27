---
title: "Blob Storage"
slug: blob-storage
brief: "Immutable objects. Erasure coding. 11 nines of durability."
date: 2026-06-12
updated: 2026-10-18
revisions: 2
---

# Blob Storage

> Images, videos and backup files that users upload. You would not dump all of that into the database, would you?

## Store large files by key

Blob storage (object storage) is for large, unstructured files. S3, GCS and Azure Blob are the representatives.

Walk through an avatar upload. User 123 uploads a 4MB photo. The app does not write those 4MB into the database. It sends the file with an HTTP PUT to the bucket `avatars` under the key `users/123/avatar.jpg`. The users table in the database gains one column that stores this key or the full URL, a few dozen bytes per row. When the frontend needs to show the avatar, it takes the URL and asks the CDN directly. The CDN fetches from the bucket the first time and serves from its own copy after that. Neither the app server nor the database ever handles the 4MB.

The `/` in the key looks like a folder, but it is not one. A bucket is a flat key space, `users/123/avatar.jpg` is one whole string, and no directory called `users` exists. Listing "what is under users/123/" is a prefix filter over keys. Objects are immutable: when the user changes their avatar, the whole image is uploaded again, and no part of the file can be edited in place. If the new image overwrites the same key, the old copy the CDN holds does not expire because of it. It stays until its cache entry expires (24 hours by default on CloudFront) or someone runs an invalidation, and until then other people still see the old avatar. So the new image usually gets a new key, such as `users/123/avatar-v2.jpg`, the database column stores the new key, and the frontend gets a URL the CDN has never seen.

Like a huge bank of lockers. Each locker has a number tag (the key). Storing large luggage is cheap and it keeps well, but the small things you dig out several times a day do not go here.

## Why it keeps so well

Behind it is erasure coding. For example, cut one object into 10 pieces, compute 4 more pieces of redundancy code, and spread the 14 across 14 different disks, even different data centers. Any 10 of them rebuild the whole object, so 4 disks can fail at the same time with no loss. Keeping three full copies instead would cost three times the capacity and reach its limit at 2 failed disks; 10 + 4 costs 1.4 times and survives 2 more. S3 advertises 11 nines, a chance of losing one object in a year small enough to ignore.

The price is that access latency for a single object is higher than a DB, and there are no partial updates. So it does not suit high frequency transactional data. It suits images, videos and backups: written once, read many times, rarely changed.
