import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CompletionController, type CompletionControllerOptions } from "./CompletionController.js";
import type { TaskCompletion, TaskCompletionResult } from "../types/completion.js";
import type { TraceWriter, TraceEvent } from "../types/trace.js";

describe("CompletionController", () => {
  let mockTraceWriter: TraceWriter;
  let traceEvents: TraceEvent[];

  beforeEach(() => {
    traceEvents = [];
    mockTraceWriter = {
      write: vi.fn((event: TraceEvent) => {
        traceEvents.push(event);
      }),
      flush: vi.fn().mockResolvedValue(undefined),
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("completion verification", () => {
    it("should return complete=true when verifyCompletion returns true", async () => {
      const taskCompletion: TaskCompletion = {
        verifyCompletion: vi.fn().mockResolvedValue({
          complete: true,
          reason: "Task done",
        }),
      };

      const controller = new CompletionController({
        taskCompletion,
        traceWriter: mockTraceWriter,
      });

      const result = await controller.check({
        iteration: 1,
        totalTokens: 100,
        totalCost: 0.01,
        turnCount: 1,
      });

      expect(result.shouldStop).toBe(true);
      expect(result.stopReason).toBe("completion");
      expect(result.verification?.complete).toBe(true);
      expect(result.verification?.reason).toBe("Task done");
      expect(result.iteration).toBe(1);
    });

    it("should return complete=false when verifyCompletion returns false", async () => {
      const taskCompletion: TaskCompletion = {
        verifyCompletion: vi.fn().mockResolvedValue({
          complete: false,
          reason: "Still working",
        }),
      };

      const controller = new CompletionController({
        taskCompletion,
        traceWriter: mockTraceWriter,
      });

      const result = await controller.check({
        iteration: 1,
        totalTokens: 100,
        totalCost: 0.01,
        turnCount: 1,
      });

      expect(result.shouldStop).toBe(false);
      expect(result.verification?.complete).toBe(false);
      expect(result.verification?.reason).toBe("Still working");
    });

    it("should handle verification errors gracefully", async () => {
      const taskCompletion: TaskCompletion = {
        verifyCompletion: vi.fn().mockRejectedValue(new Error("Verification failed")),
      };

      const controller = new CompletionController({
        taskCompletion,
        traceWriter: mockTraceWriter,
      });

      const result = await controller.check({
        iteration: 1,
        totalTokens: 100,
        totalCost: 0.01,
        turnCount: 1,
      });

      expect(result.shouldStop).toBe(false);
      expect(result.verification?.complete).toBe(false);
      expect(result.verification?.reason).toContain("Verification error");
      expect(result.verification?.details?.error).toBe(true);
    });
  });

  describe("iteration limits", () => {
    it("should stop when maxIterations is reached", async () => {
      const taskCompletion: TaskCompletion = {
        verifyCompletion: vi.fn().mockResolvedValue({
          complete: false,
          reason: "Not done",
        }),
        maxIterations: 5,
      };

      const controller = new CompletionController({
        taskCompletion,
        traceWriter: mockTraceWriter,
      });

      const result = await controller.check({
        iteration: 5,
        totalTokens: 100,
        totalCost: 0.01,
        turnCount: 5,
      });

      expect(result.shouldStop).toBe(true);
      expect(result.stopReason).toBe("max_iterations");
    });

    it("should continue when below maxIterations", async () => {
      const taskCompletion: TaskCompletion = {
        verifyCompletion: vi.fn().mockResolvedValue({
          complete: false,
          reason: "Not done",
        }),
        maxIterations: 10,
      };

      const controller = new CompletionController({
        taskCompletion,
        traceWriter: mockTraceWriter,
      });

      const result = await controller.check({
        iteration: 5,
        totalTokens: 100,
        totalCost: 0.01,
        turnCount: 5,
      });

      expect(result.shouldStop).toBe(false);
    });
  });

  describe("token limits", () => {
    it("should stop when maxTokens is exceeded", async () => {
      const taskCompletion: TaskCompletion = {
        verifyCompletion: vi.fn().mockResolvedValue({
          complete: false,
          reason: "Not done",
        }),
        maxTokens: 1000,
      };

      const controller = new CompletionController({
        taskCompletion,
        traceWriter: mockTraceWriter,
      });

      const result = await controller.check({
        iteration: 1,
        totalTokens: 1500,
        totalCost: 0.01,
        turnCount: 1,
      });

      expect(result.shouldStop).toBe(true);
      expect(result.stopReason).toBe("max_tokens");
    });

    it("should continue when below maxTokens", async () => {
      const taskCompletion: TaskCompletion = {
        verifyCompletion: vi.fn().mockResolvedValue({
          complete: false,
          reason: "Not done",
        }),
        maxTokens: 1000,
      };

      const controller = new CompletionController({
        taskCompletion,
        traceWriter: mockTraceWriter,
      });

      const result = await controller.check({
        iteration: 1,
        totalTokens: 500,
        totalCost: 0.01,
        turnCount: 1,
      });

      expect(result.shouldStop).toBe(false);
    });
  });

  describe("cost limits", () => {
    it("should stop when maxCost is exceeded", async () => {
      const taskCompletion: TaskCompletion = {
        verifyCompletion: vi.fn().mockResolvedValue({
          complete: false,
          reason: "Not done",
        }),
        maxCost: 0.1,
      };

      const controller = new CompletionController({
        taskCompletion,
        traceWriter: mockTraceWriter,
      });

      const result = await controller.check({
        iteration: 1,
        totalTokens: 100,
        totalCost: 0.15,
        turnCount: 1,
      });

      expect(result.shouldStop).toBe(true);
      expect(result.stopReason).toBe("max_cost");
    });
  });

  describe("check interval", () => {
    it("should only verify at check interval", async () => {
      const verifyMock = vi.fn().mockResolvedValue({
        complete: false,
        reason: "Not done",
      });

      const taskCompletion: TaskCompletion = {
        verifyCompletion: verifyMock,
        checkInterval: 3,
      };

      const controller = new CompletionController({
        taskCompletion,
        traceWriter: mockTraceWriter,
      });

      // Iteration 1 - should not verify
      await controller.check({
        iteration: 1,
        totalTokens: 100,
        totalCost: 0.01,
        turnCount: 1,
      });
      expect(verifyMock).not.toHaveBeenCalled();

      // Iteration 2 - should not verify
      await controller.check({
        iteration: 2,
        totalTokens: 200,
        totalCost: 0.02,
        turnCount: 2,
      });
      expect(verifyMock).not.toHaveBeenCalled();

      // Iteration 3 - should verify
      await controller.check({
        iteration: 3,
        totalTokens: 300,
        totalCost: 0.03,
        turnCount: 3,
      });
      expect(verifyMock).toHaveBeenCalledTimes(1);

      // Iteration 6 - should verify again
      await controller.check({
        iteration: 6,
        totalTokens: 600,
        totalCost: 0.06,
        turnCount: 6,
      });
      expect(verifyMock).toHaveBeenCalledTimes(2);
    });

    it("should default to checking every iteration", async () => {
      const verifyMock = vi.fn().mockResolvedValue({
        complete: false,
        reason: "Not done",
      });

      const taskCompletion: TaskCompletion = {
        verifyCompletion: verifyMock,
        // No checkInterval set
      };

      const controller = new CompletionController({
        taskCompletion,
        traceWriter: mockTraceWriter,
      });

      await controller.check({
        iteration: 1,
        totalTokens: 100,
        totalCost: 0.01,
        turnCount: 1,
      });

      await controller.check({
        iteration: 2,
        totalTokens: 200,
        totalCost: 0.02,
        turnCount: 2,
      });

      expect(verifyMock).toHaveBeenCalledTimes(2);
    });
  });

  describe("trace events", () => {
    it("should emit TaskCompletionCheckEvent", async () => {
      const taskCompletion: TaskCompletion = {
        verifyCompletion: vi.fn().mockResolvedValue({
          complete: true,
          reason: "Done",
        }),
      };

      const controller = new CompletionController({
        taskCompletion,
        traceWriter: mockTraceWriter,
      });

      await controller.check({
        iteration: 1,
        totalTokens: 100,
        totalCost: 0.01,
        turnCount: 1,
      });

      const checkEvents = traceEvents.filter((e) => e.type === "TASK_COMPLETION_CHECK");
      expect(checkEvents).toHaveLength(1);

      const event = checkEvents[0];
      if (event.type === "TASK_COMPLETION_CHECK") {
        expect(event.result.complete).toBe(true);
        expect(event.result.reason).toBe("Done");
        expect(event.iteration).toBe(1);
        expect(event.latencyMs).toBeGreaterThanOrEqual(0);
      }
    });

    it("should emit TaskIterationEvent", async () => {
      const taskCompletion: TaskCompletion = {
        verifyCompletion: vi.fn().mockResolvedValue({
          complete: false,
          reason: "Not done",
        }),
        maxIterations: 10,
      };

      const controller = new CompletionController({
        taskCompletion,
        traceWriter: mockTraceWriter,
      });

      await controller.check({
        iteration: 3,
        totalTokens: 300,
        totalCost: 0.03,
        turnCount: 3,
      });

      const iterEvents = traceEvents.filter((e) => e.type === "TASK_ITERATION");
      expect(iterEvents).toHaveLength(1);

      const event = iterEvents[0];
      if (event.type === "TASK_ITERATION") {
        expect(event.iteration).toBe(3);
        expect(event.maxIterations).toBe(10);
        expect(event.totalTokens).toBe(300);
        expect(event.totalCost).toBe(0.03);
      }
    });
  });

  describe("callbacks", () => {
    it("should call onCompletion when task is complete", async () => {
      const onCompletion = vi.fn();

      const taskCompletion: TaskCompletion = {
        verifyCompletion: vi.fn().mockResolvedValue({
          complete: true,
          reason: "Done",
        }),
      };

      const controller = new CompletionController({
        taskCompletion,
        traceWriter: mockTraceWriter,
        onCompletion,
      });

      await controller.check({
        iteration: 5,
        totalTokens: 500,
        totalCost: 0.05,
        turnCount: 5,
      });

      expect(onCompletion).toHaveBeenCalledTimes(1);
      expect(onCompletion).toHaveBeenCalledWith(
        { complete: true, reason: "Done" },
        5
      );
    });

    it("should call onLimitExceeded when limit is hit", async () => {
      const onLimitExceeded = vi.fn();

      const taskCompletion: TaskCompletion = {
        verifyCompletion: vi.fn().mockResolvedValue({
          complete: false,
          reason: "Not done",
        }),
        maxIterations: 3,
      };

      const controller = new CompletionController({
        taskCompletion,
        traceWriter: mockTraceWriter,
        onLimitExceeded,
      });

      await controller.check({
        iteration: 3,
        totalTokens: 300,
        totalCost: 0.03,
        turnCount: 3,
      });

      expect(onLimitExceeded).toHaveBeenCalledTimes(1);
      expect(onLimitExceeded).toHaveBeenCalledWith("max_iterations", {
        iteration: 3,
        totalTokens: 300,
        totalCost: 0.03,
        turnCount: 3,
      });
    });
  });

  describe("reset", () => {
    it("should reset internal state", async () => {
      const taskCompletion: TaskCompletion = {
        verifyCompletion: vi.fn().mockResolvedValue({
          complete: false,
          reason: "Not done",
        }),
      };

      const controller = new CompletionController({
        taskCompletion,
        traceWriter: mockTraceWriter,
      });

      await controller.check({
        iteration: 5,
        totalTokens: 500,
        totalCost: 0.05,
        turnCount: 5,
      });

      expect(controller.getIteration()).toBe(5);
      expect(controller.getTotalTokens()).toBe(500);
      expect(controller.getTotalCost()).toBe(0.05);

      controller.reset();

      expect(controller.getIteration()).toBe(0);
      expect(controller.getTotalTokens()).toBe(0);
      expect(controller.getTotalCost()).toBe(0);
    });
  });

  describe("priority of checks", () => {
    it("should check token limit before iteration limit", async () => {
      const taskCompletion: TaskCompletion = {
        verifyCompletion: vi.fn().mockResolvedValue({
          complete: false,
          reason: "Not done",
        }),
        maxTokens: 100,
        maxIterations: 5,
      };

      const controller = new CompletionController({
        taskCompletion,
        traceWriter: mockTraceWriter,
      });

      const result = await controller.check({
        iteration: 5,
        totalTokens: 200,
        totalCost: 0.01,
        turnCount: 5,
      });

      expect(result.shouldStop).toBe(true);
      expect(result.stopReason).toBe("max_tokens");
    });

    it("should check limits before verification", async () => {
      const verifyMock = vi.fn().mockResolvedValue({
        complete: true,
        reason: "Done",
      });

      const taskCompletion: TaskCompletion = {
        verifyCompletion: verifyMock,
        maxIterations: 3,
      };

      const controller = new CompletionController({
        taskCompletion,
        traceWriter: mockTraceWriter,
      });

      const result = await controller.check({
        iteration: 3,
        totalTokens: 100,
        totalCost: 0.01,
        turnCount: 3,
      });

      // Should stop due to iteration limit without calling verify
      expect(result.shouldStop).toBe(true);
      expect(result.stopReason).toBe("max_iterations");
      expect(verifyMock).not.toHaveBeenCalled();
    });
  });
});
