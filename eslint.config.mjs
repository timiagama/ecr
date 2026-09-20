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
      // -- TypeScript Engineering Standard -- "Be Explicit at Important Boundaries" --
      //
      // Explicit at boundaries, inference internally. Module boundaries carry
      // the contract, so they are enforced; inside an implementation the
      // standard prefers a clear inferred type to a restated one.
      //
      // no-inferrable-types stays off because src/ still carries explicit
      // annotations on local variables from an earlier rule. Turning it on
      // would demand a repository-wide sweep to remove them, which is exactly
      // the unrelated normalization the contract prohibits. They are left to
      // disappear as the surrounding code is touched.
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/no-inferrable-types': 'off',

      // -- TypeScript Engineering Standard -- "Use Types to Model the Domain" --
      //
      // Enforced across src/ rather than scoped to a list of public modules:
      // every module in src/ except cli.ts contributes declarations that
      // index.ts re-exports, so a narrower file scope would be the same set
      // of files with a maintenance burden attached.
      'ecr/no-inline-object-types': 'error',

      // -- Repository convention; the standard is silent on it --
      //
      // Used consistently in every class-bearing module. Kept because it is an
      // established convention the standard does not contradict, not because
      // the standard requires it.
      '@typescript-eslint/explicit-member-accessibility': 'error',

      // -- TypeScript Engineering Standard -- "Naming and Readability" --
      'no-nested-ternary': 'error',
      'arrow-body-style': ['error', 'as-needed'],

      // -- TypeScript Engineering Standard -- "Documentation" --
      //
      // publicOnly restricts the requirement to exported declarations, which
      // is the published API this package ships .d.ts for. Documentation on
      // an internal helper is welcome where it adds information, but it is
      // not required merely because the declaration exists.
      'jsdoc/require-jsdoc': ['error', {
        publicOnly: true,
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
      '@typescript-eslint/explicit-module-boundary-types': 'off',
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
