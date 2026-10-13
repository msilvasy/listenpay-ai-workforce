/*
    Search all user tables and native date/time columns for a target date.

    Notes:
    - Uses a half-open date range: >= target date and < following date.
      This is preferable to CAST(column AS date), because it can use indexes.
    - Returns one result set per matching date/time column.
    - A row can appear more than once if multiple date/time columns match.
    - Does not search dates stored as text (varchar/nvarchar).
*/

SET NOCOUNT ON;

DECLARE @TargetDate date = '2026-09-12';  -- <-- Set the date to search
DECLARE @NextDate   date = DATEADD(day, 1, @TargetDate);

DECLARE
    @SchemaName sysname,
    @TableName  sysname,
    @ColumnName sysname,
    @DataType   sysname,
    @Sql        nvarchar(max);

DECLARE DateColumnCursor CURSOR LOCAL FAST_FORWARD FOR
SELECT
    s.name AS SchemaName,
    t.name AS TableName,
    c.name AS ColumnName,
    ty.name AS DataType
FROM sys.tables AS t
INNER JOIN sys.schemas AS s
    ON s.schema_id = t.schema_id
INNER JOIN sys.columns AS c
    ON c.object_id = t.object_id
INNER JOIN sys.types AS ty
    ON ty.user_type_id = c.user_type_id
WHERE
    t.is_ms_shipped = 0
    AND c.is_computed = 0
    AND ty.name IN
    (
        'date',
        'datetime',
        'datetime2',
        'smalldatetime',
        'datetimeoffset'
    )
ORDER BY
    s.name,
    t.name,
    c.column_id;

OPEN DateColumnCursor;

FETCH NEXT FROM DateColumnCursor
INTO @SchemaName, @TableName, @ColumnName, @DataType;

WHILE @@FETCH_STATUS = 0
BEGIN
    /*
       datetimeoffset needs special handling. This comparison treats the
       target date as the calendar date represented by the stored value.
       For datetime/datetime2/date/smalldatetime, the range predicate is
       index-friendly.
    */
    IF @DataType = 'datetimeoffset'
    BEGIN
        SET @Sql = N'
            IF EXISTS
            (
                SELECT 1
                FROM ' + QUOTENAME(@SchemaName) + N'.' + QUOTENAME(@TableName) + N'
                WHERE CONVERT(date, ' + QUOTENAME(@ColumnName) + N') = @TargetDate
            )
            BEGIN
                SELECT
                    N''' + REPLACE(@SchemaName, '''', '''''') + N'.' +
                              REPLACE(@TableName, '''', '''''') + N''' AS SourceTable,
                    N''' + REPLACE(@ColumnName, '''', '''''') + N''' AS MatchingColumn,
                    *
                FROM ' + QUOTENAME(@SchemaName) + N'.' + QUOTENAME(@TableName) + N'
                WHERE CONVERT(date, ' + QUOTENAME(@ColumnName) + N') = @TargetDate;
            END;';
    END
    ELSE
    BEGIN
        SET @Sql = N'
            IF EXISTS
            (
                SELECT 1
                FROM ' + QUOTENAME(@SchemaName) + N'.' + QUOTENAME(@TableName) + N'
                WHERE ' + QUOTENAME(@ColumnName) + N' >= @TargetDate
                  AND ' + QUOTENAME(@ColumnName) + N' <  @NextDate
            )
            BEGIN
                SELECT
                    N''' + REPLACE(@SchemaName, '''', '''''') + N'.' +
                              REPLACE(@TableName, '''', '''''') + N''' AS SourceTable,
                    N''' + REPLACE(@ColumnName, '''', '''''') + N''' AS MatchingColumn,
                    *
                FROM ' + QUOTENAME(@SchemaName) + N'.' + QUOTENAME(@TableName) + N'
                WHERE ' + QUOTENAME(@ColumnName) + N' >= @TargetDate
                  AND ' + QUOTENAME(@ColumnName) + N' <  @NextDate;
            END;';
    END;

    EXEC sys.sp_executesql
        @Sql,
        N'@TargetDate date, @NextDate date',
        @TargetDate = @TargetDate,
        @NextDate = @NextDate;

    FETCH NEXT FROM DateColumnCursor
    INTO @SchemaName, @TableName, @ColumnName, @DataType;
END;

CLOSE DateColumnCursor;
DEALLOCATE DateColumnCursor;