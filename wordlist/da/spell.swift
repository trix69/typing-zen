// Prints every word macOS's Danish spelling dictionary doesn't know, one line of input per line of output:
// "<line number>\t<word>". Used by build_words_da.py (swift wordlist/da/spell.swift < lines).
import AppKit
let checker = NSSpellChecker.shared
var n = 0
while let line = readLine() {
  n += 1
  let text = line as NSString
  var at = 0
  while at < text.length {
    let r = checker.checkSpelling(of: line, startingAt: at, language: "da", wrap: false, inSpellDocumentWithTag: 0, wordCount: nil)
    if r.location == NSNotFound { break }
    print("\(n)\t\(text.substring(with: r))")
    at = r.location + r.length
  }
}
