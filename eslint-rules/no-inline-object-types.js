/**
 * ESLint rule: no-inline-object-types
 *
 * Disallows inline object type literals in function parameter and return type
 * annotations. Requires extracting them to a named interface or type alias.
 *
 * Bad:  function foo(config: { retries: number }): void
 * Bad:  function bar(): { status: string }
 * Good: function foo(config: FooConfig): void
 * Good: function bar(): BarResult
 */

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Disallow inline object type literals in function signatures. Use a named interface or type alias instead.',
    },
    messages: {
      parameterType:
        'Use a named interface or type alias instead of an inline object type for parameter "{{name}}".',
      returnType:
        'Use a named interface or type alias instead of an inline object type for the return type.',
    },
    schema: [],
  },

  create(context) {
    /**
     * Checks whether an AST node is a TSTypeLiteral (inline object type).
     * Also catches it when wrapped in TSIntersectionType or TSUnionType
     * (e.g., `param: { a: string } & { b: number }`).
     */
    function containsInlineObjectType(node) {
      if (!node) {
        return false;
      }
      if (node.type === 'TSTypeLiteral') {
        return true;
      }
      if (
        node.type === 'TSIntersectionType' ||
        node.type === 'TSUnionType'
      ) {
        return node.types.some(containsInlineObjectType);
      }
      return false;
    }

    function checkFunction(node) {
      // Check parameters
      for (const param of node.params) {
        const target =
          param.type === 'AssignmentPattern' ? param.left : param;

        if (
          target.typeAnnotation &&
          containsInlineObjectType(target.typeAnnotation.typeAnnotation)
        ) {
          context.report({
            node: target.typeAnnotation,
            messageId: 'parameterType',
            data: { name: target.name || 'destructured' },
          });
        }
      }

      // Check return type
      if (
        node.returnType &&
        containsInlineObjectType(node.returnType.typeAnnotation)
      ) {
        context.report({
          node: node.returnType,
          messageId: 'returnType',
        });
      }
    }

    return {
      FunctionDeclaration: checkFunction,
      FunctionExpression: checkFunction,
      ArrowFunctionExpression: checkFunction,
      TSMethodSignature: checkFunction,
      TSFunctionType: checkFunction,
    };
  },
};

export default rule;
