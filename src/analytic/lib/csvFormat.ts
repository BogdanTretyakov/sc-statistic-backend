import {
  CsvFormatterStream,
  FormatterOptions,
  type FormatterOptionsArgs,
  type Row,
} from '@fast-csv/format';
import { once } from 'events';
import { createWriteStream, type WriteStream } from 'fs';

export class AwaitableCsv<
  I extends Row,
  O extends Row,
> extends CsvFormatterStream<I, O> {
  private writeFsStream: WriteStream;
  private lastError?: Error;

  constructor(options: FormatterOptionsArgs<I, O>, writeFilePath: string) {
    super(new FormatterOptions(options));
    this.writeFsStream = createWriteStream(writeFilePath);
    this.pipe(this.writeFsStream);

    const handleError = (err: Error) => {
      this.lastError = err;
      this.destroy(err);
    };

    this.on('error', handleError);
    this.writeFsStream.on('error', handleError);
  }

  async writeDrain(row: I) {
    if (this.lastError) throw this.lastError;
    if (!this.write(row)) {
      await once(this.writeFsStream, 'drain');
    }
  }

  async finalize(): Promise<void> {
    this.end();
    await once(this.writeFsStream, 'finish');
  }
}
