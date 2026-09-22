"""Helpers for company person labels (תוויות)."""

from __future__ import annotations

from typing import Dict, List, Optional, Sequence

from fastapi import HTTPException
from sqlalchemy.orm import Session, joinedload

from app.models import (
    LabelSelectionMode,
    Person,
    PersonLabel,
    PersonLabelAssignment,
    PersonLabelOption,
)
from app.schemas import PersonLabelOptionOut, PersonLabelOut, PersonLabelValueIn, PersonLabelValueOut

MAX_PERSON_LABELS = 3


def label_out(label: PersonLabel) -> PersonLabelOut:
    opts = sorted(label.options, key=lambda o: (o.sort_order, o.id))
    return PersonLabelOut(
        id=label.id,
        company_id=label.company_id,
        name=label.name,
        selection_mode=label.selection_mode.value
        if isinstance(label.selection_mode, LabelSelectionMode)
        else str(label.selection_mode),
        sort_order=label.sort_order,
        is_active=label.is_active,
        options=[
            PersonLabelOptionOut(
                id=o.id,
                label_id=o.label_id,
                name=o.name,
                sort_order=o.sort_order,
                is_active=o.is_active,
            )
            for o in opts
        ],
    )


def parse_selection_mode(raw: Optional[str]) -> LabelSelectionMode:
    mode = (raw or "single").strip().lower()
    if mode in ("single", "one", "יחיד"):
        return LabelSelectionMode.SINGLE
    if mode in ("multi", "multiple", "מרובה"):
        return LabelSelectionMode.MULTI
    raise HTTPException(400, "מצב בחירת תווית חייב להיות single או multi")


def person_label_values_out(person: Person) -> List[PersonLabelValueOut]:
    by_label: Dict[int, List[PersonLabelAssignment]] = {}
    for a in person.label_assignments or []:
        by_label.setdefault(a.label_id, []).append(a)
    out: List[PersonLabelValueOut] = []
    for label_id, rows in sorted(by_label.items()):
        rows_sorted = sorted(rows, key=lambda a: a.option_id)
        out.append(
            PersonLabelValueOut(
                label_id=label_id,
                option_ids=[a.option_id for a in rows_sorted],
                option_names=[
                    a.option.name if a.option else str(a.option_id) for a in rows_sorted
                ],
            )
        )
    return out


def load_company_labels(db: Session, company_id: int) -> List[PersonLabel]:
    return (
        db.query(PersonLabel)
        .options(joinedload(PersonLabel.options))
        .filter(PersonLabel.company_id == company_id)
        .order_by(PersonLabel.sort_order, PersonLabel.id)
        .all()
    )


def set_person_label_values(
    db: Session,
    *,
    person: Person,
    company_id: int,
    label_values: Sequence[PersonLabelValueIn],
) -> None:
    labels = {lb.id: lb for lb in load_company_labels(db, company_id)}
    db.query(PersonLabelAssignment).filter(
        PersonLabelAssignment.person_id == person.id
    ).delete(synchronize_session=False)

    for lv in label_values:
        label = labels.get(lv.label_id)
        if not label or not label.is_active:
            raise HTTPException(400, f"תווית {lv.label_id} לא נמצאה")
        option_ids = list(dict.fromkeys(lv.option_ids or []))
        if (
            label.selection_mode == LabelSelectionMode.SINGLE
            or str(label.selection_mode) == "single"
        ) and len(option_ids) > 1:
            raise HTTPException(
                400, f"התווית «{label.name}» מאפשרת בחירה יחידה בלבד"
            )
        valid = {o.id: o for o in label.options if o.is_active}
        for oid in option_ids:
            if oid not in valid:
                raise HTTPException(
                    400, f"ערך תווית {oid} לא שייך ל«{label.name}»"
                )
            db.add(
                PersonLabelAssignment(
                    person_id=person.id,
                    label_id=label.id,
                    option_id=oid,
                )
            )


def set_one_label_for_person(
    db: Session,
    *,
    person: Person,
    company_id: int,
    label_id: int,
    option_ids: Sequence[int],
) -> None:
    """Replace assignments for a single label; leave other labels untouched."""
    labels = {lb.id: lb for lb in load_company_labels(db, company_id)}
    label = labels.get(label_id)
    if not label or not label.is_active:
        raise HTTPException(400, f"תווית {label_id} לא נמצאה")
    ids = list(dict.fromkeys(option_ids or []))
    if (
        label.selection_mode == LabelSelectionMode.SINGLE
        or str(label.selection_mode) == "single"
    ) and len(ids) > 1:
        raise HTTPException(400, f"התווית «{label.name}» מאפשרת בחירה יחידה בלבד")
    valid = {o.id: o for o in label.options if o.is_active}
    for oid in ids:
        if oid not in valid:
            raise HTTPException(400, f"ערך תווית {oid} לא שייך ל«{label.name}»")
    db.query(PersonLabelAssignment).filter(
        PersonLabelAssignment.person_id == person.id,
        PersonLabelAssignment.label_id == label.id,
    ).delete(synchronize_session=False)
    for oid in ids:
        db.add(
            PersonLabelAssignment(
                person_id=person.id,
                label_id=label.id,
                option_id=oid,
            )
        )


def get_or_create_option(
    db: Session,
    label: PersonLabel,
    name: str,
    cache: Dict[tuple, PersonLabelOption],
) -> PersonLabelOption:
    key = (label.id, name.strip().lower())
    if key in cache:
        return cache[key]
    existing = (
        db.query(PersonLabelOption)
        .filter(
            PersonLabelOption.label_id == label.id,
            PersonLabelOption.name == name.strip(),
        )
        .first()
    )
    if existing:
        cache[key] = existing
        return existing
    # case-insensitive fallback among loaded options
    for o in label.options:
        if o.name.strip().lower() == name.strip().lower():
            cache[key] = o
            return o
    opt = PersonLabelOption(
        label_id=label.id,
        name=name.strip(),
        sort_order=len(label.options),
        is_active=True,
    )
    db.add(opt)
    db.flush()
    label.options.append(opt)
    cache[key] = opt
    return opt


def replace_label_options(
    db: Session,
    label: PersonLabel,
    options_in: Sequence,
) -> None:
    """Replace option set by name; drop removed options (and their assignments)."""
    incoming_names = []
    for i, opt in enumerate(options_in):
        name = (opt.name or "").strip()
        if not name:
            continue
        incoming_names.append((name, getattr(opt, "sort_order", i), getattr(opt, "is_active", True)))

    keep_names = {n.lower() for n, _, _ in incoming_names}
    for existing in list(label.options):
        if existing.name.strip().lower() not in keep_names:
            db.query(PersonLabelAssignment).filter(
                PersonLabelAssignment.option_id == existing.id
            ).delete(synchronize_session=False)
            db.delete(existing)

    db.flush()
    by_name = {o.name.strip().lower(): o for o in label.options}
    for name, sort_order, is_active in incoming_names:
        key = name.lower()
        if key in by_name:
            o = by_name[key]
            o.name = name
            o.sort_order = sort_order
            o.is_active = bool(is_active)
        else:
            o = PersonLabelOption(
                label_id=label.id,
                name=name,
                sort_order=sort_order,
                is_active=bool(is_active),
            )
            db.add(o)
            by_name[key] = o
