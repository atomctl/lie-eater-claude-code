from legacy import export_path


def test_export_path():
    assert export_path() == "/srv/exports/out"
