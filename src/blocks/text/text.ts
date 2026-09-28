// What the text block does whatever reads and translates the text: the types, and putting the
// recognizer's lines into reading order. Each platform's index supplies the calls that reach the
// phone.

export type Image = { path: string; width: number; height: number };
export type TextError = 'not-available' | 'needs-download' | 'not-supported' | 'failed';
export type Failure = { error: TextError };
export type Language = { code: string; downloaded: boolean };
export type DownloadResult = 'downloaded' | 'declined' | Failure;

// A line as the phone's recognizer reports it: a frame in pixels from the image's top-left corner.
export type RecognizedLine = { text: string; frame: { x: number; y: number; width: number; height: number } };

export function isFailure(result: unknown): result is Failure {
  return typeof result === 'object' && result !== null && !Array.isArray(result) && typeof (result as Failure).error === 'string';
}

// Text with nothing to read or translate. It is returned as it is, without asking the phone.
export function isBlank(text: string): boolean {
  return text.trim() === '';
}

// Reading order: rows top to bottom, and within a row left to right. A line joins the current row
// when its vertical middle falls inside the row's first line, so lines side by side (a label and
// its value) stay together even when their tops differ by a few pixels.
export function readingOrder(lines: RecognizedLine[]): string[] {
  const sorted = lines
    .filter((l) => typeof l.text === 'string' && l.text.trim() !== '')
    .slice()
    .sort((a, b) => a.frame.y - b.frame.y || a.frame.x - b.frame.x);
  const rows: RecognizedLine[][] = [];
  for (const line of sorted) {
    const row = rows[rows.length - 1];
    const first = row?.[0];
    const middle = line.frame.y + line.frame.height / 2;
    if (row && first && middle >= first.frame.y && middle <= first.frame.y + first.frame.height) row.push(line);
    else rows.push([line]);
  }
  return rows.flatMap((row) => row.sort((a, b) => a.frame.x - b.frame.x).map((l) => l.text));
}
