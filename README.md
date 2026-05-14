# pureproperty-etl-worker

ETL worker for processing and syncing property data with Supabase.

## Setup

```bash
npm install
```

Copy `.env.example` to `.env` and configure the environment variables.

## Usage

```bash
node index.js
```

## Dependencies

- [@supabase/supabase-js](https://www.npmjs.com/package/@supabase/supabase-js) - Supabase client
- [axios](https://www.npmjs.com/package/axios) - HTTP client
- [dotenv](https://www.npmjs.com/package/dotenv) - Environment variables