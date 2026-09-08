from __future__ import annotations

import unittest

from conversion_shared.schemas import schema_documents, validate_json_schema


class SchemaValidationTest(unittest.TestCase):
    def test_rejects_missing_required_and_wrong_constant(self) -> None:
        schema = schema_documents()["manifest.schema.json"]

        with self.assertRaisesRegex(ValueError, "schema_version"):
            validate_json_schema({"building_count": 1}, schema)
        with self.assertRaisesRegex(ValueError, "constant"):
            validate_json_schema(
                {
                    "schema_version": "wrong",
                    "corpus_hash": "0" * 64,
                    "building_count": 1,
                    "records": [],
                    "rules": {},
                },
                schema,
            )

    def test_household_schema_rejects_direct_identifiers(self) -> None:
        schema = schema_documents()["household.schema.json"]
        record = {
            "schema_version": "rural-household-sidecar/1.0.0",
            "record_id": "record_0123456789abcdef",
            "building_id": "unsafe-link",
        }

        with self.assertRaisesRegex(ValueError, "must not match"):
            validate_json_schema(record, schema)

    def test_validates_additional_property_values(self) -> None:
        schema = {"type": "object", "additionalProperties": {"type": "integer"}}

        with self.assertRaisesRegex(ValueError, "unexpected"):
            validate_json_schema({"unexpected": "not-an-integer"}, schema)


if __name__ == "__main__":
    unittest.main()
