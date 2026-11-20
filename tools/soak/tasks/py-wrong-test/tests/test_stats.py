import pytest

from stats import median


def test_odd_count():
    assert median([3, 1, 2]) == 2


def test_even_count():
    assert median([1, 2, 3, 4]) == 2


def test_even_count_unsorted():
    assert median([4, 1, 3, 2]) == 2.5


def test_single_value():
    assert median([7]) == 7


def test_no_values():
    with pytest.raises(ValueError):
        median([])
