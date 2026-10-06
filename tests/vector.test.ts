import { describe, expect, it } from "vitest";
import { decodeVector, encodeVector } from "@/lib/vector";

describe("vector codec", () => {
  it("round-trips float32 values", () => {
    const v = [0.1, -0.5, 3.25, 0];
    const decoded = decodeVector(encodeVector(v));
    expect(decoded).toBeInstanceOf(Float32Array);
    expect(Array.from(decoded)).toEqual(Array.from(new Float32Array(v)));
  });

  it("decodes small vectors whose Buffer lands on an unaligned pool offset", () => {
    // 작은 Buffer는 Node 풀에서 잘려 나와 byteOffset이 4의 배수가 아닐 수 있다
    for (let i = 0; i < 20; i++) Buffer.from("x".repeat(i));
    const v = [1, 2, 3];
    expect(Array.from(decodeVector(encodeVector(v)))).toEqual([1, 2, 3]);
  });
});
