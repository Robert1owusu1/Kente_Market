import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
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
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
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
    },
  },
])
