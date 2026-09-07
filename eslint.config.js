import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      reactHooks.configs['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 'latest',
      globals: globals.browser, // 👈 for React frontend
      parserOptions: {
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      // The base rule doesn't understand TS (type-only params, ambient .d.ts
      // declarations), so rely on the TS-aware rule instead.
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^_' }],
      // `any` casts are the sanctioned escape hatch for heterogeneous legacy
      // API payloads during the incremental TS migration; keep them visible as
      // warnings (not build-blocking) so they can be tightened later.
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    files: ['tailwind.config.js', 'postcss.config.js', '**/*.config.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: globals.node,
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      'no-undef': 'off',
    },
  },
  {
    files: ['./backend/**/*.{js,ts}', './backend/*.js'], // 👈 adjust to match your backend folder
    languageOptions: {
      ecmaVersion: 'latest',
      globals: {
        ...globals.node, // 👈 enable Node.js globals like process, __dirname, require
      },
      sourceType: 'module',
    },
    rules: {
      // Express requires the 4-arg (err, req, res, next) signature for error
      // middleware, where `next` may legitimately be unused.
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^next$' }],
      '@typescript-eslint/no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^(_|next$)' }],
    },
  },
  {
    // Ambient/type declaration files: params are type signatures, not runtime vars.
    files: ['./backend/**/*.d.ts'],
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
])