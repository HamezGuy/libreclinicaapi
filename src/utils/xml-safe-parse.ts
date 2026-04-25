import xml2js from 'xml2js';

const XXE_PATTERN = /<!DOCTYPE|<!ENTITY/i;

/**
 * Parse XML safely with XXE protection.
 * Rejects any input containing DOCTYPE or ENTITY declarations,
 * then delegates to xml2js with strict mode enabled.
 */
export async function safeXmlParse(
  xml: string,
  options?: xml2js.ParserOptions
): Promise<unknown> {
  if (XXE_PATTERN.test(xml)) {
    throw new Error('XML rejected: DOCTYPE or ENTITY declarations are not allowed');
  }

  const parser = new xml2js.Parser({ strict: true, ...options });
  return parser.parseStringPromise(xml);
}
