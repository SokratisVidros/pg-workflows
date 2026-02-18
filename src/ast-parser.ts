import * as ts from 'typescript';
import type { InternalStepDefinition, StepType, WorkflowContext } from './types';

type ParseWorkflowHandlerReturnType = {
  steps: InternalStepDefinition[];
};

export function parseWorkflowHandler(
  handler: (context: WorkflowContext) => Promise<unknown>,
): ParseWorkflowHandlerReturnType {
  const handlerSource = handler.toString();
  const sourceFile = ts.createSourceFile('handler.ts', handlerSource, ts.ScriptTarget.Latest, true);

  const steps: Map<string, InternalStepDefinition> = new Map();

  function isInConditional(node: ts.Node): boolean {
    let current = node.parent;
    while (current) {
      if (
        ts.isIfStatement(current) ||
        ts.isConditionalExpression(current) ||
        ts.isSwitchStatement(current) ||
        ts.isCaseClause(current)
      ) {
        return true;
      }
      current = current.parent;
    }
    return false;
  }

  function isInLoop(node: ts.Node): boolean {
    let current = node.parent;
    while (current) {
      if (
        ts.isForStatement(current) ||
        ts.isForInStatement(current) ||
        ts.isForOfStatement(current) ||
        ts.isWhileStatement(current) ||
        ts.isDoStatement(current)
      ) {
        return true;
      }
      current = current.parent;
    }
    return false;
  }

  function extractStepId(arg: ts.Expression): {
    id: string;
    isDynamic: boolean;
  } {
    if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) {
      return { id: arg.text, isDynamic: false };
    }

    if (ts.isTemplateExpression(arg)) {
      let templateStr = arg.head.text;
      for (const span of arg.templateSpans) {
        templateStr += `\${...}`;
        templateStr += span.literal.text;
      }
      return { id: templateStr, isDynamic: true };
    }

    return { id: arg.getText(sourceFile), isDynamic: true };
  }

  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const propertyAccess = node.expression;
      const objectName = propertyAccess.expression.getText(sourceFile);
      const methodName = propertyAccess.name.text;

      if (
        objectName === 'step' &&
        (methodName === 'run' ||
          methodName === 'waitFor' ||
          methodName === 'pause' ||
          methodName === 'waitUntil')
      ) {
        const firstArg = node.arguments[0];
        if (firstArg) {
          const { id, isDynamic } = extractStepId(firstArg);

          const stepDefinition: InternalStepDefinition = {
            id,
            type: methodName as StepType,
            conditional: isInConditional(node),
            loop: isInLoop(node),
            isDynamic,
          };

          if (steps.has(id)) {
            throw new Error(
              `Duplicate step ID detected: '${id}'. Step IDs must be unique within a workflow.`,
            );
          }

          steps.set(id, stepDefinition);
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  return { steps: Array.from(steps.values()) };
}
