import { readFileSync, existsSync } from 'fs';
import { defineConfig } from 'prisma/config';

let dbUrl = process.env.DATABASE_URL;

if (existsSync('.env')) {
  const content = readFileSync('.env', 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('DATABASE_URL=')) {
      const val = trimmed.substring('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
      if (val) dbUrl = val;
    }
  }
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: dbUrl,
  },
});
