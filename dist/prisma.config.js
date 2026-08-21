"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = require("fs");
const config_1 = require("prisma/config");
let dbUrl = process.env.DATABASE_URL;
if ((0, fs_1.existsSync)('.env')) {
    const content = (0, fs_1.readFileSync)('.env', 'utf-8');
    for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.startsWith('DATABASE_URL=')) {
            const val = trimmed.substring('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
            if (val)
                dbUrl = val;
        }
    }
}
exports.default = (0, config_1.defineConfig)({
    schema: 'prisma/schema.prisma',
    migrations: {
        path: 'prisma/migrations',
    },
    datasource: {
        url: dbUrl,
    },
});
//# sourceMappingURL=prisma.config.js.map