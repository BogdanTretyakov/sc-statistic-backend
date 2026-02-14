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
  private buffers: Record<LogLevel, LogEntry[]> = {
    fatal: [],
    error: [],
    warn: [],
    log: [],
    verbose: [],
    debug: [],
  };
  private defaultMaxSize: Record<LogLevel, number> = {
    fatal: 300,
    error: 300,
    warn: 300,
    log: 500,
    verbose: 100,
    debug: 100,
  };

  constructor() {
    super(BufferedLogger.name);
    if (process.env.NODE_ENV === 'production') {
      this.setLogLevels(['fatal', 'error']);
    } else {
      this.setLogLevels(['fatal', 'error', 'warn', 'log', 'verbose', 'debug']);
    }
  }

  private addToBuffer(
    level: LogLevel,
    message: string,
    context: string = 'UnknownContext',
  ) {
    const item = { level, message, context, time: new Date() };
    this.buffers[level].push(item);
    if (this.buffers[level].length > this.defaultMaxSize[level]) {
      this.buffers[level].shift();
    }
  }

  override fatal(message: string, context?: string) {
    super.fatal(message, context);
    this.addToBuffer('fatal', message, context ?? UnknownContext);
  }

  override log(message: string, context?: string) {
    super.log(message, context);
    this.addToBuffer('log', message, context ?? UnknownContext);
  }

  override error(message: string, trace?: string, context?: string) {
    super.error(message, trace, context);
    this.addToBuffer(
      'error',
      `${message} ${trace ?? ''}`,
      context ?? UnknownContext,
    );
  }

  override warn(message: string, context?: string) {
    super.warn(message, context);
    this.addToBuffer('warn', message, context ?? UnknownContext);
  }

  override debug(message: string, context?: string) {
    super.debug(message, context);
    this.addToBuffer('debug', message, context ?? UnknownContext);
  }

  override verbose(message: string, context?: string) {
    super.verbose(message, context);
    this.addToBuffer('verbose', message, context ?? UnknownContext);
  }

  getLogs() {
    return Object.values(this.buffers)
      .flat()
      .sort((a, b) => {
        if (a.level === 'fatal' && b.level !== 'fatal') return -1;
        return b.time.valueOf() - a.time.valueOf();
      });
  }
}
