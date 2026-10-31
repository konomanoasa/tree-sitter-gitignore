import unittest
from types import CapsuleType

import tree_sitter_gitignore

from tree_sitter import Language, Parser, Query, QueryCursor


class BindingsTest(unittest.TestCase):
    def test_language_capsule_parses_source_with_external_scanner(self):
        capsule = tree_sitter_gitignore.language()
        self.assertIsInstance(capsule, CapsuleType)
        language = Language(capsule)
        self.assertEqual(language.name, "gitignore")
        source = b"*.log\n!keep.log\n"
        tree = Parser(language).parse(source)
        self.assertEqual(tree.root_node.type, "document")
        self.assertFalse(tree.root_node.has_error)
        self.assertEqual(tree.root_node.text, source)

    def test_packaged_highlights_capture_patterns(self):
        language = Language(tree_sitter_gitignore.language())
        tree = Parser(language).parse(b"*.log\n!keep.log\n")
        query = Query(language, tree_sitter_gitignore.HIGHLIGHTS_QUERY)
        captures = QueryCursor(query).captures(tree.root_node)
        self.assertEqual(
            [node.text for node in captures["string.special.path"]],
            [b".log", b"keep.log"],
        )


if __name__ == "__main__":
    unittest.main()
