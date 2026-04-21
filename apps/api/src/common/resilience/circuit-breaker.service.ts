import { Injectable, Logger } from '@nestjs/common';

/**
 * Circuit Breaker — prevents cascading failures from flaky APIs.
 *
 * When a source fails 3 times in a row, the circuit "opens" and
 * all subsequent calls are skipped for 5 minutes. After the cooldown,
 * one test call is allowed through. If it succeeds, the circuit closes.
 *
 * States:
 * - CLOSED: normal operation, requests pass through
 * - OPEN: requests are rejected immediately (source is down)
 * - HALF_OPEN: one test request allowed to check if source recovered
 */

interface CircuitState {
  failures: number;
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  lastFailure: number;
  openedAt: number;
}

const FAILURE_THRESHOLD = 3;
const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

@Injectable()
export class CircuitBreakerService {
  private readonly logger = new Logger(CircuitBreakerService.name);
  private readonly circuits = new Map<string, CircuitState>();

  /**
   * Execute a function with circuit breaker protection.
   * Returns null if the circuit is open (source is down).
   */
  async execute<T>(source: string, fn: () => Promise<T>): Promise<T | null> {
    const circuit = this.getCircuit(source);

    if (circuit.state === 'OPEN') {
      // Check if cooldown has passed
      if (Date.now() - circuit.openedAt > COOLDOWN_MS) {
        circuit.state = 'HALF_OPEN';
        this.logger.log(`Circuit ${source}: HALF_OPEN — testing recovery`);
      } else {
        return null; // Skip — source is down
      }
    }

    try {
      const result = await fn();

      // Success — close the circuit
      if (circuit.state === 'HALF_OPEN') {
        this.logger.log(`Circuit ${source}: recovered → CLOSED`);
      }
      circuit.failures = 0;
      circuit.state = 'CLOSED';

      return result;
    } catch (e: any) {
      circuit.failures++;
      circuit.lastFailure = Date.now();

      if (circuit.failures >= FAILURE_THRESHOLD) {
        circuit.state = 'OPEN';
        circuit.openedAt = Date.now();
        this.logger.warn(`Circuit ${source}: OPEN after ${circuit.failures} failures — skipping for ${COOLDOWN_MS / 1000}s`);
      }

      throw e;
    }
  }

  /** Check if a source is available (circuit not open) */
  isAvailable(source: string): boolean {
    const circuit = this.getCircuit(source);
    if (circuit.state === 'OPEN') {
      return Date.now() - circuit.openedAt > COOLDOWN_MS;
    }
    return true;
  }

  /** Get circuit state for diagnostics */
  getStatus(): Record<string, { state: string; failures: number }> {
    const result: Record<string, { state: string; failures: number }> = {};
    for (const [source, circuit] of this.circuits) {
      result[source] = { state: circuit.state, failures: circuit.failures };
    }
    return result;
  }

  private getCircuit(source: string): CircuitState {
    if (!this.circuits.has(source)) {
      this.circuits.set(source, { failures: 0, state: 'CLOSED', lastFailure: 0, openedAt: 0 });
    }
    return this.circuits.get(source)!;
  }
}
