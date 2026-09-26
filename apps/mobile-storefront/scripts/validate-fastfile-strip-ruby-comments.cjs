function stripRubyComments(source) {
  let inBlockComment = false;
  return source
    .split('\n')
    .filter((line) => {
      if (/^=begin(?:\s|$)/.test(line)) {
        inBlockComment = true;
        return false;
      }
      if (inBlockComment) {
        if (/^=end(?:\s|$)/.test(line)) inBlockComment = false;
        return false;
      }
      return true;
    })
    .map((line) => line.replace(/(^|\s)#.*$/, '$1'))
    .join('\n');
}

module.exports = stripRubyComments;
