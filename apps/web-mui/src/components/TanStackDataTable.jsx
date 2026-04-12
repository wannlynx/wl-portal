import { useMemo, useState } from "react";
import {
  Box,
  Button,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography
} from "@mui/material";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable
} from "@tanstack/react-table";

export function TanStackDataTable({
  rows,
  columns,
  globalSearchPlaceholder = "Search all columns...",
  initialPageSize = 10,
  emptyMessage = "No results found.",
  onRowClick,
  getRowId,
  isRowSelected
}) {
  const [sorting, setSorting] = useState([]);
  const [columnFilters, setColumnFilters] = useState([]);
  const [globalFilter, setGlobalFilter] = useState("");

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting, columnFilters, globalFilter },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getRowId,
    initialState: {
      pagination: { pageIndex: 0, pageSize: initialPageSize }
    }
  });

  const totalRows = rows.length;
  const filteredRows = table.getFilteredRowModel().rows.length;
  const pageCount = table.getPageCount();

  const filterableHeaders = useMemo(
    () => table.getAllLeafColumns().filter((column) => column.getCanFilter()),
    [table]
  );

  return (
    <Stack spacing={1.5}>
      <Typography variant="caption" color="text.secondary">
        Showing {filteredRows} of {totalRows} rows
      </Typography>

      <Stack direction={{ xs: "column", md: "row" }} spacing={1.25} useFlexGap flexWrap="wrap">
        <TextField
          size="small"
          value={globalFilter}
          onChange={(event) => setGlobalFilter(event.target.value)}
          placeholder={globalSearchPlaceholder}
          sx={{ minWidth: { xs: "100%", md: 240 } }}
        />
        {filterableHeaders.map((column) => (
          <TextField
            key={column.id}
            size="small"
            value={column.getFilterValue() ?? ""}
            onChange={(event) => column.setFilterValue(event.target.value)}
            placeholder={`Filter ${String(column.columnDef.header)}`}
            sx={{ minWidth: { xs: "100%", md: 180 } }}
          />
        ))}
      </Stack>

      <TableContainer component={Paper} variant="outlined" sx={{ overflowX: "auto" }}>
        <Table size="small">
          <TableHead>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const sort = header.column.getIsSorted();
                  return (
                    <TableCell
                      key={header.id}
                      align={header.column.columnDef.meta?.align || "left"}
                      sx={{ whiteSpace: "nowrap", minWidth: header.column.columnDef.meta?.minWidth || 120 }}
                    >
                      {header.isPlaceholder ? null : (
                        <Button
                          variant="text"
                          color="inherit"
                          onClick={header.column.getToggleSortingHandler()}
                          sx={{ px: 0, minWidth: 0, textTransform: "none", fontWeight: 700 }}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {sort === "asc" ? " ↑" : sort === "desc" ? " ↓" : " ↕"}
                        </Button>
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableHead>
          <TableBody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row, index) => (
                <TableRow
                  key={row.id}
                  hover
                  selected={Boolean(isRowSelected?.(row.original))}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                  sx={{ backgroundColor: index % 2 === 0 ? "background.paper" : "rgba(15, 23, 42, 0.02)" }}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} align={cell.column.columnDef.meta?.align || "left"}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length}>
                  <Box sx={{ py: 3, textAlign: "center" }}>
                    <Typography color="text.secondary">{emptyMessage}</Typography>
                  </Box>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" spacing={1.25}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Button variant="outlined" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
            Previous
          </Button>
          <Typography variant="body2" color="text.secondary">
            Page {table.getState().pagination.pageIndex + 1} of {pageCount || 1}
          </Typography>
          <Button variant="outlined" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
            Next
          </Button>
        </Stack>
        <TextField
          select
          size="small"
          label="Rows"
          value={table.getState().pagination.pageSize}
          onChange={(event) => table.setPageSize(Number(event.target.value))}
          sx={{ minWidth: 120 }}
        >
          {[5, 10, 15, 20, 25].map((pageSize) => (
            <MenuItem key={pageSize} value={pageSize}>
              Show {pageSize}
            </MenuItem>
          ))}
        </TextField>
      </Stack>
    </Stack>
  );
}
