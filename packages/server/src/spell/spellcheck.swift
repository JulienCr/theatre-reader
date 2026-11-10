import AppKit

// Reads one word per line on stdin, prints those French NSSpellChecker rejects.
let checker = NSSpellChecker.shared
let tag = NSSpellChecker.uniqueSpellDocumentTag()
_ = checker.setLanguage("fr")
while let word = readLine() {
  let r = checker.checkSpelling(of: word, startingAt: 0, language: "fr", wrap: false, inSpellDocumentWithTag: tag, wordCount: nil)
  if r.location != NSNotFound { print(word) }
}
