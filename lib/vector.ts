export function encodeVector(v: ArrayLike<number>): string {
  const f = Float32Array.from(v);
  return Buffer.from(f.buffer, f.byteOffset, f.byteLength).toString("base64");
}

export function decodeVector(s: string): Float32Array {
  const buf = Buffer.from(s, "base64");
  // 풀에서 잘린 Buffer는 정렬되지 않았을 수 있어 복사한다
  const copy = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Float32Array(copy);
}
