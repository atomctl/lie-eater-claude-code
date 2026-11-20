import os


def export_path():
    """Where exports go. The folder comes from a variable that the build server sets."""
    return os.environ["EXPORT_DIR"] + "/out"
