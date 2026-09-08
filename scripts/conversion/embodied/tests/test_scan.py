from fractions import Fraction as F


def test_scan_inverse_and_midpoint_wrap() -> None:
    from embodied.scan import ScanDoor, scan_geometry

    scan = scan_geometry(
        4000,
        3000,
        1000,
        [
            ScanDoor("right", (F(3000), F(0)), 2, 900),
            ScanDoor("left", (F(1000), F(0)), 2, 900),
        ],
    )
    assert [d.door.id for d in scan.doors] == ["left", "right"]
    assert scan.leg_lengths == (3000, 5000, 6000, 5000, 3000)
    assert scan.recover_bbox() == (4000, 3000)


def test_scan_odd_width_and_recess_depth() -> None:
    from embodied.scan import ScanDoor, scan_geometry

    scan = scan_geometry(
        4001,
        3000,
        1000,
        [
            ScanDoor("deep", (F(1000), F(500)), 2, 900),
            ScanDoor("shallow", (F(1000), F(0)), 2, 900),
        ],
    )
    assert scan.start == (F(4001, 2), -1000)
    assert [d.depth for d in scan.doors] == [1000, 1500]
    assert scan.recover_bbox() == (4001, 3000)
