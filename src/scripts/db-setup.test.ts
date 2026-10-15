import { describe, expect, it } from 'vitest';

import { shortenConstraintNames, splitStatements } from './db-setup';

describe('shortenConstraintNames', () => {
  it('leaves names within the MySQL limit untouched', () => {
    const sql = 'ALTER TABLE `a` ADD CONSTRAINT `a_b_fk` FOREIGN KEY (`b`) REFERENCES `b`(`id`)';
    expect(shortenConstraintNames(sql)).toEqual({ sql, renamed: 0 });
  });

  it('shortens over-long names to at most 64 characters, deterministically and uniquely', () => {
    const longA = `${'a'.repeat(70)}_one_fk`;
    const longB = `${'a'.repeat(70)}_two_fk`;
    const sql = `ADD CONSTRAINT \`${longA}\` x; ADD CONSTRAINT \`${longB}\` y;`;
    const first = shortenConstraintNames(sql);
    expect(first.renamed).toBe(2);
    const names = [...first.sql.matchAll(/CONSTRAINT `([^`]+)`/g)].map((m) => m[1]);
    expect(names.every((n) => n.length <= 64)).toBe(true);
    expect(new Set(names).size).toBe(2);
    expect(shortenConstraintNames(sql).sql).toBe(first.sql);
  });
});

describe('splitStatements', () => {
  it('drops leading noise and splits on CREATE/ALTER TABLE boundaries', () => {
    const sql = 'Reading schema files:\n/x/schema.ts\n\nCREATE TABLE `a` (\n\t`id` int;\n);\nCREATE TABLE `b` (\n\t`id` int\n);\nALTER TABLE `b` ADD CONSTRAINT `c` FOREIGN KEY (`id`) REFERENCES `a`(`id`);\n';
    const statements = splitStatements(sql);
    expect(statements).toHaveLength(3);
    expect(statements[0]).toMatch(/^CREATE TABLE `a`/);
    expect(statements[2]).toMatch(/^ALTER TABLE `b`/);
    expect(statements.every((s) => !s.endsWith(';'))).toBe(true);
  });

  it('throws when there is nothing to create', () => {
    expect(() => splitStatements('nothing here')).toThrow(/no CREATE TABLE/);
  });
});
