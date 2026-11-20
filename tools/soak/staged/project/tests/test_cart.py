import pytest

from cart import total


def test_no_discount():
    assert total([10, 20]) == 30


def test_discount_in_percent():
    assert total([100], discount=10) == 90
    assert total([200], discount=50) == 100


def test_empty_cart():
    assert total([]) == 0


def test_prices_must_be_numbers():
    with pytest.raises(TypeError):
        total(["a"])
