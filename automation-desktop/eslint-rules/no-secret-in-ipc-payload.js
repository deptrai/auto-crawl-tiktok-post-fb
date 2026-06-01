export default {
  meta: {
    type: 'problem',
    schema: [],
    messages: { noSecret: 'Do not send Secret payload over IPC directly.' }
  },
  create(context) {
    return {
      Identifier(node) {
        if (node.name.toLowerCase().includes('secret') && context.filename.includes('/ipc')) {
          context.report({ node, messageId: 'noSecret' })
        }
      }
    }
  }
}
