export default {
  meta: {
    type: 'problem',
    schema: [],
    messages: { noDirectLogger: 'Use centralized logging adapter instead of direct console usage.' }
  },
  create(context) {
    return {
      MemberExpression(node) {
        if (node.object.type === 'Identifier' && node.object.name === 'console') {
          context.report({ node, messageId: 'noDirectLogger' })
        }
      }
    }
  }
}
