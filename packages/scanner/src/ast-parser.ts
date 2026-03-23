import ts from "typescript"

import { extractStaticTemplateTokens, splitClassTokens } from "./template-handler"

function extractFromExpression(node: ts.Expression): string[] {
  if (ts.isStringLiteralLike(node)) {
    return splitClassTokens(node.text)
  }

  if (ts.isNoSubstitutionTemplateLiteral(node)) {
    return splitClassTokens(node.text)
  }

  if (ts.isTemplateExpression(node)) {
    const quasis = [
      { value: { cooked: node.head.text } },
      ...node.templateSpans.map((span) => ({ value: { cooked: span.literal.text } })),
    ]
    return extractStaticTemplateTokens(quasis)
  }

  if (ts.isConditionalExpression(node)) {
    return [...extractFromExpression(node.whenTrue), ...extractFromExpression(node.whenFalse)]
  }

  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
  ) {
    return [...extractFromExpression(node.left), ...extractFromExpression(node.right)]
  }

  if (
    ts.isBinaryExpression(node) &&
    (node.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
      node.operatorToken.kind === ts.SyntaxKind.PlusToken)
  ) {
    return [...extractFromExpression(node.left), ...extractFromExpression(node.right)]
  }

  if (ts.isArrayLiteralExpression(node)) {
    const classes: string[] = []
    for (const element of node.elements) {
      if (ts.isExpression(element)) classes.push(...extractFromExpression(element))
    }
    return classes
  }

  if (ts.isCallExpression(node)) {
    const classes: string[] = []
    for (const argument of node.arguments) {
      classes.push(...extractFromExpression(argument))
    }
    return classes
  }

  return []
}

function getTagNameFromJsxAttribute(name: ts.JsxAttributeName): string {
  if (ts.isIdentifier(name)) return name.text
  return name.getText()
}

export function parseJsxLikeClasses(source: string): string[] {
  const sourceFile = ts.createSourceFile(
    "source.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  )
  const classes = new Set<string>()

  const visit = (node: ts.Node) => {
    if (
      ts.isJsxAttribute(node) &&
      (getTagNameFromJsxAttribute(node.name) === "className" ||
        getTagNameFromJsxAttribute(node.name) === "class")
    ) {
      const initializer = node.initializer
      if (initializer && ts.isStringLiteralLike(initializer)) {
        for (const token of splitClassTokens(initializer.text)) classes.add(token)
      }

      if (initializer && ts.isJsxExpression(initializer) && initializer.expression) {
        for (const token of extractFromExpression(initializer.expression)) classes.add(token)
      }
    }

    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "tw"
    ) {
      for (const argument of node.arguments) {
        for (const token of extractFromExpression(argument)) classes.add(token)
      }
    }

    if (
      ts.isTaggedTemplateExpression(node) &&
      ts.isIdentifier(node.tag) &&
      node.tag.text === "tw"
    ) {
      const template = node.template
      if (ts.isNoSubstitutionTemplateLiteral(template)) {
        for (const token of splitClassTokens(template.text)) classes.add(token)
      } else if (ts.isTemplateExpression(template)) {
        const quasis = [
          { value: { cooked: template.head.text } },
          ...template.templateSpans.map((span) => ({ value: { cooked: span.literal.text } })),
        ]
        for (const token of extractStaticTemplateTokens(quasis)) classes.add(token)
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)

  return Array.from(classes)
}
