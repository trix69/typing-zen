// Reads words (one per line) on stdin and prints each with macOS's Mandarin-to-pinyin reading, for
// build_words_zh.py to compare against the lists. With --syllables, prints every syllable macOS gives for
// the 20,902 common CJK characters (U+4E00-U+9FA5): the set of real pinyin syllables.
import Foundation
func py(_ s: String) -> String {
  let m = NSMutableString(string: s)
  CFStringTransform(m, nil, kCFStringTransformMandarinLatin, false)
  return m as String
}
if CommandLine.arguments.contains("--syllables") {
  var all = Set<String>()
  for u in 0x4E00...0x9FA5 { if let c = Unicode.Scalar(u) { all.insert(py(String(Character(c)))) } }
  for s in all.sorted() { print(s) }
} else {
  while let line = readLine() { print(line + "\t" + py(line)) }
}
