export default {
  meta: {
    type: 'problem',
    schema: [],
    messages: { noSecretToString: 'Calling toString() on Secret-like value is forbidden.' }
  },
  create(context) {
    return {
      CallExpression(node) {
        if (
          node.callee.type === 'MemberExpression' &&
          node.callee.property.type === 'Identifier' &&
          node.callee.property.name === 'toString'
        ) {
          context.report({ node, messageId: 'noSecretToString' })
        }
      }
    }
  }
}
