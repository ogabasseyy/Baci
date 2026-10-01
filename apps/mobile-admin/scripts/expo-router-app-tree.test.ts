import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const appDirectory = path.resolve(__dirname, '../app');
const applicationDirectories = [
  'app',
  'components',
  'config',
  'constants',
  'context',
  'hooks',
  'lib',
  'schemas',
  'services',
  'stores',
  'types',
  'utils',
]
  .map((directory) => path.resolve(__dirname, '..', directory))
  .filter((directory) => existsSync(directory));

function walkFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const fullPath = path.join(directory, entry);
    if (statSync(fullPath).isDirectory()) {
      return walkFiles(fullPath);
    }
    return fullPath;
  });
}

function isApplicationSourceFile(filePath: string): boolean {
  return (
    /\.[jt]sx?$/.test(filePath) &&
    !/\.(test|spec|test-fixtures|test-support|test-harness)\.[jt]sx?$/.test(
      filePath
    )
  );
}

function hasIncompatibleReactNavigationImport(source: string): boolean {
  return /from\s+['"]@react-navigation\//.test(source);
}

describe('walkFiles helper', () => {
  it('returns only file paths in a directory tree', () => {
    const filePaths = walkFiles(appDirectory);

    expect(filePaths.length).toBeGreaterThan(0);
    expect(filePaths.every((filePath) => typeof filePath === 'string')).toBe(
      true
    );
    expect(
      filePaths.every((filePath) => !statSync(filePath).isDirectory())
    ).toBe(true);
  });
});

describe('isApplicationSourceFile helper', () => {
  it('includes normal application source files', () => {
    expect(isApplicationSourceFile('hooks/useExpenseFormHandlers.ts')).toBe(
      true
    );
  });

  it.each([
    'expense.test-support.ts',
    'expense.test-harness.tsx',
    'expense.test-fixtures.tsx',
  ])('excludes helper-only source %s', (filePath) => {
    expect(isApplicationSourceFile(filePath)).toBe(false);
  });
});

describe('hasIncompatibleReactNavigationImport helper', () => {
  it.each([
    "import { useNavigation } from '@react-navigation/native';",
    'import { useNavigation } from "@react-navigation/native";',
  ])('detects incompatible import %s', (source) => {
    expect(hasIncompatibleReactNavigationImport(source)).toBe(true);
  });
});

describe('Expo Router app tree', () => {
  it('does not contain helper-only files that Expo Router would parse as routes', () => {
    const allFiles = walkFiles(appDirectory);

    const helperRouteFiles = allFiles
      .map((filePath) => path.relative(appDirectory, filePath))
      .filter(
        (filePath) =>
          filePath.endsWith('.styles.ts') ||
          /(^|[\\/])_layout\.(test|spec)\.[jt]sx?$/.test(filePath) ||
          /\.test-fixtures\.[jt]sx?$/.test(filePath) ||
          /\.test-(support|harness)\.[jt]sx?$/.test(filePath) ||
          path.basename(filePath).startsWith('VariantConditionEditor.')
      );

    expect(helperRouteFiles).toEqual([]);
  });

  it('does not import React Navigation from SDK 56-incompatible entry points', () => {
    const incompatibleImports = applicationDirectories
      .flatMap(walkFiles)
      .filter(isApplicationSourceFile)
      .filter((filePath) =>
        hasIncompatibleReactNavigationImport(readFileSync(filePath, 'utf8'))
      )
      .map((filePath) => path.relative(path.resolve(__dirname, '..'), filePath));

    expect(incompatibleImports).toEqual([]);
  });
});
