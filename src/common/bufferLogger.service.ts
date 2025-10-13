import { ConsoleLogger, Injectable, LogLevel } from '@nestjs/common';

interface LogEntry {
  level: LogLevel;
  message: string;
  context?: string;
  time: Date;
}

const UnknownContext = 'UnknownContext';

@Injectable()
export class BufferedLogger extends ConsoleLogger {
  private buffers: Record<string, LogEntry[]> = {};
  private defaultMaxSize = 500;
  private logLevels: LogLevel[] = ['error', 'warn', 'log', 'fatal'];

  constructor() {
    super(BufferedLogger.name);
    this.setLogLevels(this.logLevels);
  }

  private addToBuffer(
    level: LogLevel,
    message: string,
    context: string = 'default',
  ) {
    if (!this.buffers[context]) {
      this.buffers[context] = [];
    }
    this.buffers[context].push({ level, message, context, time: new Date() });
    if (this.buffers[context].length > this.defaultMaxSize) {
      this.buffers[context].shift();
    }
  }

  fatal(message: string, context?: string) {
    super.fatal(message, context);
    this.addToBuffer('fatal', message, context ?? UnknownContext);
  }

  log(message: string, context?: string) {
    super.log(message, context);
    this.addToBuffer('log', message, context ?? UnknownContext);
  }

  error(message: string, trace?: string, context?: string) {
    super.error(message, trace, context);
    this.addToBuffer(
      'error',
      `${message} ${trace ?? ''}`,
      context ?? UnknownContext,
    );
  }

  warn(message: string, context?: string) {
    super.warn(message, context);
    this.addToBuffer('warn', message, context ?? UnknownContext);
  }

  debug(message: string, context?: string) {
    super.debug(message, context);
    this.addToBuffer('debug', message, context ?? UnknownContext);
  }

  verbose(message: string, context?: string) {
    super.verbose(message, context);
    this.addToBuffer('verbose', message, context ?? UnknownContext);
  }

  getLogs(context?: string) {
    if (context) {
      return this.buffers[context]?.slice() ?? [];
    }
    return Object.values(this.buffers)
      .flat()
      .sort((a, b) => a.time.valueOf() - b.time.valueOf());
  }
}
