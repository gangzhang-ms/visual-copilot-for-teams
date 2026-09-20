import { expect, it } from "vitest";
import { allocateSamples, sampleIndices } from "./media-normalizer";
it("shares one verified image budget without padding or invisible omissions", () => {
  expect(allocateSamples([6, 6], 10)).toEqual([5, 5]);
  expect(allocateSamples([6, 6], 5)).toEqual([3, 2]);
  expect(allocateSamples([1, 6], 10)).toEqual([1, 6]);
  expect(allocateSamples([1, 6], 3)).toEqual([1, 2]);
  expect(() => allocateSamples([6, 6], 3)).toThrow("image-budget-exceeded");
  expect(() => allocateSamples([1, 6], 0)).toThrow();
  expect(sampleIndices([100, 100, 100], 6, [0, 300])).toEqual([0, 1, 2]);
});
