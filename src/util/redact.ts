const secretPatterns: RegExp[] = [
  /\b(authorization\s*:\s*bearer\s+)[^\s,;]+/gi,
  /\b(set-cookie|cookie)(\s*:\s*).*?(?=\s+\b(?:set-cookie|cookie|authorization|api[_-]?key|token|secret|password|session[_-]?id)\s*[:=]|\r?\n|$)/gi,
  /\b(api[_-]?key|token|secret|password|session[_-]?id)(\s*[:=]\s*)[^,\s;]+/gi,
];

export function redactForLog(value: string): string {
  return secretPatterns.reduce((text, pattern) => {
    return text.replace(pattern, (...args: [string, string, ...unknown[]]) => {
      const [, prefix, maybeSeparator] = args;
      const separator = typeof maybeSeparator === 'string' ? maybeSeparator : '';

      if (/cookie|set-cookie/i.test(prefix)) {
        return `${prefix}${separator}[REDACTED]`;
      }

      return `${prefix}${separator}[REDACTED]`;
    });
  }, value);
}
