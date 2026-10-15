/**
 * Story 7.3 — fail on a displayable string literal in a component or view.
 * Catalog keys passed to `t()` / `translate()` are allowed. The French source
 * lives in `src/lib/i18n/`, which this rule does not visit.
 */

const DISPLAY_ATTRS = new Set([
  "placeholder",
  "title",
  "alt",
  "aria-label",
  "aria-description",
  "aria-placeholder",
  "aria-roledescription",
  "aria-valuetext",
]);

const DISPLAY_PROPS = new Set([
  "label",
  "title",
  "description",
  "placeholder",
  "alt",
  "message",
  "subtitle",
  "hint",
  "heading",
]);

const TRANSLATE_CALLEES = new Set(["t", "translate"]);

function rawText(node) {
  if (!node) return null;
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) {
    return node.quasis.map((q) => q.value.cooked ?? "").join("");
  }
  return null;
}

function isDisplayable(text) {
  return typeof text === "string" && /\p{L}{2,}/u.test(text);
}

function isCatalogKey(text) {
  return /^[a-z0-9]+(?:\.[a-zA-Z0-9_]+)+$/.test(text);
}

function isTokenCode(text) {
  return /^[A-Z0-9]{1,6}$/.test(text);
}

/** Human copy, not an id, a CSS class, an ISO-style code, or punctuation (—, …). */
function isHumanCopy(text) {
  if (!isDisplayable(text)) return false;
  if (isTokenCode(text) || isCatalogKey(text)) return false;
  if (/^[a-z0-9_]+$/.test(text)) return false;
  if (/\b(bg|text|border|flex|grid|px|py|w|h)-/.test(text)) return false;
  if (/\s/.test(text) || /[^\u0000-\u007F]/.test(text)) return true;
  return /^[A-ZÀ-Ÿ][a-zà-ÿ'-]{2,}$/.test(text);
}

function isInsideTranslateCall(node) {
  const parent = node.parent;
  if (!parent || parent.type !== "CallExpression" || parent.arguments[0] !== node) return false;
  const callee = parent.callee;
  return callee.type === "Identifier" && TRANSLATE_CALLEES.has(callee.name);
}

function report(context, node, text) {
  context.report({
    node,
    messageId: "literal",
    data: { text: text.replace(/\s+/g, " ").trim().slice(0, 80) },
  });
}

const rule = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow displayable string literals outside the UI catalogs.",
    },
    schema: [],
    messages: {
      literal:
        'Displayable string "{{text}}" must go through the UI catalog (t / translate). A hardcoded label is invisible to the translation coverage check.',
    },
  },
  create(context) {
    function check(node) {
      if (isInsideTranslateCall(node)) return;
      const text = rawText(node);
      if (!isDisplayable(text) || isCatalogKey(text)) return;
      report(context, node, text);
    }

    return {
      JSXText(node) {
        const text = node.value.replace(/\s+/g, " ").trim();
        if (!isDisplayable(text)) return;
        report(context, node, text);
      },
      JSXExpressionContainer(node) {
        const parent = node.parent;
        if (!parent) return;
        const inChild =
          parent.type === "JSXElement" || parent.type === "JSXFragment";
        const inAttr =
          parent.type === "JSXAttribute" &&
          parent.name.type === "JSXIdentifier" &&
          DISPLAY_ATTRS.has(parent.name.name);
        if (!inChild && !inAttr) return;
        check(node.expression);
      },
      JSXAttribute(node) {
        if (node.name.type !== "JSXIdentifier" || !DISPLAY_ATTRS.has(node.name.name)) return;
        if (!node.value || node.value.type === "JSXExpressionContainer") return;
        check(node.value);
      },
      Property(node) {
        const key =
          node.key.type === "Identifier"
            ? node.key.name
            : node.key.type === "Literal"
              ? String(node.key.value)
              : null;
        if (!key || !DISPLAY_PROPS.has(key)) return;
        const text = rawText(node.value);
        if (!text || !isHumanCopy(text) || isInsideTranslateCall(node.value)) return;
        report(context, node.value, text);
      },
      LogicalExpression(node) {
        if (node.operator !== "||" && node.operator !== "??") return;
        const text = rawText(node.right);
        if (!text || !isHumanCopy(text) || isInsideTranslateCall(node.right)) return;
        report(context, node.right, text);
      },
      CallExpression(node) {
        const callee = node.callee;
        const isToast =
          (callee.type === "Identifier" && callee.name === "toast") ||
          (callee.type === "MemberExpression" &&
            callee.object.type === "Identifier" &&
            callee.object.name === "toast");
        if (!isToast || node.arguments.length === 0) return;
        check(node.arguments[0]);
      },
    };
  },
};

export default rule;
