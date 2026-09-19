import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import jsdoc from 'eslint-plugin-jsdoc';
import tsdoc from 'eslint-plugin-tsdoc';
import noInlineObjectTypes from './eslint-rules/no-inline-object-types.js';

const ecrPlugin = {
  rules: {
    'no-inline-object-types': noInlineObjectTypes,
  },
};

export default tseslint.config(
  { ignores: ['**/dist/', '**/node_modules/'] },

  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.eslint.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { jsdoc, tsdoc, ecr: ecrPlugin },
    rules: {
      // -- 2.2: Explicit typing on all boundaries --
      '@typescript-eslint/explicit-function-return-type': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/typedef': ['error', {
        variableDeclaration: true,
        variableDeclarationIgnoreFunction: false,
      }],
      '@typescript-eslint/no-inferrable-types': 'off',

      // -- 3.4: Explicit access modifiers --
      '@typescript-eslint/explicit-member-accessibility': 'error',

      // -- 2.4: Named types for object shapes --
      'ecr/no-inline-object-types': 'error',

      // -- 2.1: Readability --
      'no-nested-ternary': 'error',
      'arrow-body-style': ['error', 'as-needed'],

      // -- 4.2: TSDoc --
      'jsdoc/require-jsdoc': ['error', {
        require: {
          FunctionDeclaration: true,
          MethodDefinition: true,
          ClassDeclaration: true,
        },
        contexts: [
          'TSInterfaceDeclaration',
          'TSTypeAliasDeclaration',
        ],
      }],
      'tsdoc/syntax': 'error',
    },
  },

  // -------------------------------------------------------------------------
  // Tests
  //
  // Test files are held to correctness rules but not to the production
  // documentation and explicit-typing standards. Non-null assertions on fixture
  // data, inferred locals and undocumented helpers are normal test idiom, and
  // enforcing otherwise adds noise without adding safety. Rules that catch real
  // defects -- unused variables, floating promises, misused promises -- stay on.
  // -------------------------------------------------------------------------
  {
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/typedef': 'off',
      '@typescript-eslint/array-type': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/non-nullable-type-assertion-style': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/no-duplicate-type-constituents': 'off',
      '@typescript-eslint/dot-notation': 'off',
      'arrow-body-style': 'off',
      'jsdoc/require-jsdoc': 'off',
      'tsdoc/syntax': 'off',
      'ecr/no-inline-object-types': 'off',
    },
  },
);
