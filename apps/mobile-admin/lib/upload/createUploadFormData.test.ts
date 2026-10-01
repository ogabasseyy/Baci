import { convertFormDataAsync } from 'expo/src/winter/fetch/convertFormData';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createUploadFormData } from './createUploadFormData';

const mocks = vi.hoisted(() => ({
  append: vi.fn(),
  File: vi.fn(function NativeFile(uri: string) {
    return {
      bytes: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
      name: 'picked.jpg',
      type: 'image/jpeg',
      uri,
    };
  }),
}));

vi.mock('expo-file-system', () => ({ File: mocks.File }));

class NativeFormData {
  private readonly parts: [string, unknown][] = [];

  append(name: string, value: unknown, filename?: string) {
    mocks.append(name, value, filename);
    this.parts.push([name, value]);
  }

  entries(): IterableIterator<[string, unknown]> {
    return this.parts[Symbol.iterator]();
  }
}

describe('createUploadFormData', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    mocks.append.mockReset();
    mocks.File.mockReset();
  });

  it('serializes an Expo File bytes part with the supplied multipart metadata', async () => {
    vi.stubGlobal('FormData', NativeFormData);

    const formData = createUploadFormData({
      name: 'store-avatar.jpg',
      type: 'image/jpeg',
      uri: 'file:///picked.jpg',
    });

    expect(formData).toBeInstanceOf(NativeFormData);
    expect(mocks.File).toHaveBeenCalledWith('file:///picked.jpg');
    expect(mocks.append).toHaveBeenCalledWith(
      'file',
      expect.objectContaining({
        bytes: expect.any(Function),
        name: 'store-avatar.jpg',
        type: 'image/jpeg',
      }),
      'store-avatar.jpg'
    );

    const { body } = await convertFormDataAsync(
      formData,
      '----ExpoFetchFormBoundaryTest'
    );
    const bodyText = new TextDecoder().decode(body);
    expect(bodyText).toContain(
      'content-disposition: form-data; name="file"; filename="store-avatar.jpg"'
    );
    expect(bodyText).toContain('content-type: image/jpeg');

    const serializedBytes = Array.from(body);
    const fileBytesOffset = serializedBytes.indexOf(1);
    expect(serializedBytes.slice(fileBytesOffset, fileBytesOffset + 3)).toEqual(
      [1, 2, 3]
    );
  });
});
