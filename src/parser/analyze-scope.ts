import type ESTree from "estree";
import type { Scope, ScopeManager } from "eslint-scope";
import { Variable, Reference, analyze } from "eslint-scope";
import { getFallbackKeys } from "../traverse";
import type { SvelteReactiveStatement, SvelteScriptElement } from "../ast";
import { addReference, addVariable } from "../scope";
import { addElementToSortedArray } from "../utils";
/**
 * Analyze scope
 */
export function analyzeScope(
  node: ESTree.Node,
  parserOptions: any = {},
): ScopeManager {
  const ecmaVersion = parserOptions.ecmaVersion || 2020;
  const ecmaFeatures = parserOptions.ecmaFeatures || {};
  const sourceType = parserOptions.sourceType || "module";

  const root: ESTree.Program =
    node.type === "Program"
      ? node
      : {
          type: "Program",
          body: [node as ESTree.Statement],
          sourceType,
        };

  return analyze(root, {
    ignoreEval: true,
    nodejsScope: false,
    impliedStrict: ecmaFeatures.impliedStrict,
    ecmaVersion: typeof ecmaVersion === "number" ? ecmaVersion : 2022,
    sourceType,
    fallback: getFallbackKeys,
  });
}

/** Analyze reactive scope */
export function analyzeReactiveScope(scopeManager: ScopeManager): void {
  for (const reference of [...scopeManager.globalScope.through]) {
    const parent = reference.writeExpr && getParent(reference.writeExpr);
    if (parent?.type === "AssignmentExpression") {
      const pp = getParent(parent);
      if (pp?.type === "ExpressionStatement") {
        const ppp = getParent(pp) as ESTree.Node | SvelteReactiveStatement;
        if (ppp?.type === "SvelteReactiveStatement" && ppp.label.name === "$") {
          const referenceScope: Scope = reference.from;
          if (referenceScope.type === "module") {
            // It is computed
            transformComputedVariable(parent, ppp, reference);
            continue;
          }
        }
      }
    }
  }

  /** Transform ref to ComputedVariable */
  function transformComputedVariable(
    node: ESTree.AssignmentExpression,
    parent: SvelteReactiveStatement,
    reference: Reference,
  ) {
    const referenceScope: Scope = reference.from;
    const name = reference.identifier.name;
    let variable = referenceScope.set.get(name);
    if (!variable) {
      variable = new Variable();
      (variable as any).scope = referenceScope;
      variable.name = name;
      addElementToSortedArray(
        variable.defs,
        {
          type: "ComputedVariable" as "Variable",
          node: node as any,
          parent: parent as any,
          name: reference.identifier,
        },
        (a, b) => a.node.range[0] - b.node.range[0],
      );
      addVariable(referenceScope.variables, variable);
      referenceScope.set.set(name, variable);
    }
    addElementToSortedArray(
      variable.identifiers,
      reference.identifier,
      (a, b) => a.range![0] - b.range![0],
    );
    reference.resolved = variable;
    removeReferenceFromThrough(reference, referenceScope);
  }
}

/**
 * Analyze store scope. e.g. $count
 */
export function analyzeStoreScope(scopeManager: ScopeManager): void {
  const moduleScope = scopeManager.scopes.find(
    (scope) => scope.type === "module",
  );
  if (!moduleScope) {
    return;
  }
  const toBeMarkAsUsedReferences: Reference[] = [];

  for (const reference of [...scopeManager.globalScope.through]) {
    if (reference.identifier.name.startsWith("$")) {
      const realName = reference.identifier.name.slice(1);
      const variable = moduleScope.set.get(realName);
      if (variable) {
        if (reference.isWriteOnly()) {
          // Need mark as used
          toBeMarkAsUsedReferences.push(reference);
        }

        // It does not write directly to the original variable.
        // Therefore, this variable is always a reference.
        reference.isWrite = () => false;
        reference.isWriteOnly = () => false;
        reference.isReadWrite = () => false;
        reference.isReadOnly = () => true;
        reference.isRead = () => true;

        addReference(variable.references, reference);
        reference.resolved = variable;
        removeReferenceFromThrough(reference, moduleScope);
      }
    }
  }

  for (const variable of new Set(
    toBeMarkAsUsedReferences.map((ref) => ref.resolved!),
  )) {
    if (
      variable.references.some(
        (ref) =>
          !toBeMarkAsUsedReferences.includes(ref) &&
          ref.identifier !== variable.identifiers[0],
      )
    ) {
      // It is already used.
      continue;
    }

    // Add the virtual reference for reading.
    (
      addVirtualReference(variable.identifiers[0], variable, moduleScope, {
        read: true,
      }) as any
    ).svelteMarkAsUsed = true;
  }
}

/** Transform props exports */
export function analyzePropsScope(
  body: SvelteScriptElement,
  scopeManager: ScopeManager,
): void {
  const moduleScope = scopeManager.scopes.find(
    (scope) => scope.type === "module",
  );
  if (!moduleScope) {
    return;
  }

  for (const node of body.body) {
    if (node.type !== "ExportNamedDeclaration") {
      continue;
    }
    if (node.declaration) {
      if (node.declaration.type === "VariableDeclaration") {
        for (const decl of node.declaration.declarations) {
          if (decl.id.type === "Identifier") {
            addPropsReference(decl.id, moduleScope);
          }
        }
      }
    } else {
      for (const spec of node.specifiers) {
        addPropsReference(spec.local, moduleScope);
      }
    }
  }

  /** Add virtual props reference */
  function addPropsReference(node: ESTree.Identifier, scope: Scope) {
    for (const variable of scope.variables) {
      if (variable.name !== node.name) {
        continue;
      }

      if (variable.references.some((ref) => (ref as any).sveltePropReference)) {
        continue;
      }

      // Add the virtual reference for writing.
      const reference = addVirtualReference(
        {
          ...node,
          // @ts-expect-error -- ignore
          parent: body,
          loc: {
            start: { ...node.loc!.start },
            end: { ...node.loc!.end },
          },
          range: [...node.range!],
        },
        variable,
        scope,
        {
          write: true,
          read: true,
        },
      );
      (reference as any).sveltePropReference = true;
    }
  }
}

/** Remove reference from through */
function removeReferenceFromThrough(reference: Reference, baseScope: Scope) {
  const variable = reference.resolved!;
  const name = reference.identifier.name;
  let scope: Scope | null = baseScope;
  while (scope) {
    scope.through = scope.through.filter((ref) => {
      if (reference === ref) {
        return false;
      } else if (ref.identifier.name === name) {
        ref.resolved = variable;
        if (!variable.references.includes(ref)) {
          addReference(variable.references, ref);
        }
        return false;
      }
      return true;
    });
    scope = scope.upper;
  }
}

/**
 * Add the virtual reference.
 */
function addVirtualReference(
  node: ESTree.Identifier,
  variable: Variable,
  scope: Scope,
  readWrite: { read?: boolean; write?: boolean },
) {
  const reference = new Reference();
  (reference as any).svelteVirtualReference = true;
  reference.from = scope;
  reference.identifier = node;
  reference.isWrite = () => Boolean(readWrite.write);
  reference.isWriteOnly = () => Boolean(readWrite.write) && !readWrite.read;
  reference.isRead = () => Boolean(readWrite.read);
  reference.isReadOnly = () => Boolean(readWrite.read) && !readWrite.write;
  reference.isReadWrite = () => Boolean(readWrite.read && readWrite.write);

  addReference(variable.references, reference);
  reference.resolved = variable;

  return reference;
}

/** Get parent node */
function getParent(node: ESTree.Node): ESTree.Node | null {
  return (node as any).parent;
}
