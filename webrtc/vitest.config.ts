import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        testTimeout: 10000,
        hookTimeout: 10000,
        teardownTimeout: 5000,
        globals: true,
        setupFiles: ['./tests/setup.ts']
    },
});
