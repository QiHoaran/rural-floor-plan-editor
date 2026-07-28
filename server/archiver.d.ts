declare module 'archiver' {
  import { Transform, type TransformOptions } from 'node:stream';
  import { type ZlibOptions } from 'node:zlib';

  interface CoreOptions {
    statConcurrency?: number;
  }

  interface ZipOptions {
    zlib?: ZlibOptions;
    forceLocalTime?: boolean;
    forceZip64?: boolean;
    store?: boolean;
    comment?: string;
  }

  type ArchiverOptions = CoreOptions & TransformOptions & ZipOptions;

  export class Archiver extends Transform {
    abort(): this;
    append(
      source: Buffer | string,
      data?: { name: string; date?: Date | string; store?: boolean },
    ): this;
    file(filepath: string, data?: { name?: string }): this;
    directory(dirpath: string, destpath?: string): this;
    pointer(): number;
    finalize(): Promise<void>;
  }

  export class ZipArchive extends Archiver {
    constructor(options?: CoreOptions & TransformOptions & ZipOptions);
  }

  export class TarArchive extends Archiver {
    constructor(
      options?: CoreOptions &
        TransformOptions & { gzip?: boolean; gzipOptions?: ZlibOptions },
    );
  }
}
